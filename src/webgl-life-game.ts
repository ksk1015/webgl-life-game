type UiElements = {
  canvas: HTMLCanvasElement
  runButton: HTMLButtonElement
  stepButton: HTMLButtonElement
  resetButton: HTMLButtonElement
  clearButton: HTMLButtonElement
  zoomInButton: HTMLButtonElement
  zoomOutButton: HTMLButtonElement
  modeButton: HTMLButtonElement
  generationLabel: HTMLElement
  zoomLabel: HTMLElement
  boardLabel: HTMLElement
}

type PointerMode = 'draw' | 'pan'

type ScreenPoint = {
  x: number
  y: number
}

type WorldPoint = {
  x: number
  y: number
}

const FULLSCREEN_VERTEX_SHADER = `#version 300 es
void main() {
  vec2 position;
  if (gl_VertexID == 0) {
    position = vec2(-1.0, -1.0);
  } else if (gl_VertexID == 1) {
    position = vec2(3.0, -1.0);
  } else {
    position = vec2(-1.0, 3.0);
  }
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const STEP_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uState;
uniform ivec2 uBoardSize;

out vec4 outColor;

bool isAlive(ivec2 cell) {
  if (cell.x < 0 || cell.y < 0 || cell.x >= uBoardSize.x || cell.y >= uBoardSize.y) {
    return false;
  }

  return texelFetch(uState, cell, 0).r > 0.5;
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  int neighbors = 0;

  for (int offsetY = -1; offsetY <= 1; offsetY++) {
    for (int offsetX = -1; offsetX <= 1; offsetX++) {
      if (offsetX == 0 && offsetY == 0) {
        continue;
      }
      neighbors += isAlive(cell + ivec2(offsetX, offsetY)) ? 1 : 0;
    }
  }

  bool alive = isAlive(cell);
  bool nextAlive = neighbors == 3 || (alive && neighbors == 2);
  float encoded = nextAlive ? 1.0 : 0.0;
  outColor = vec4(encoded, 0.0, 0.0, 1.0);
}
`

const RESET_FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp usampler2D;

uniform uint uSeed;
uniform float uDensity;

out vec4 outColor;

uint hash(uint x) {
  x ^= x >> 16u;
  x *= 0x45d9f3bu;
  x ^= x >> 16u;
  return x;
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  uint h = hash(hash(uint(cell.x) ^ (uSeed * 1664525u)) ^ (uint(cell.y) * 1013904223u));
  float value = float(h) / 4294967295.0;
  float encoded = value < uDensity ? 1.0 : 0.0;
  outColor = vec4(encoded, 0.0, 0.0, 1.0);
}
`

const DRAW_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uState;
uniform vec2 uCanvasSize;
uniform vec2 uBoardSize;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uGridOpacity;

out vec4 outColor;

void main() {
  vec2 screen = vec2(gl_FragCoord.x, gl_FragCoord.y) - 0.5 * uCanvasSize;
  vec2 world = screen / uZoom + uCameraCenter;
  ivec2 cell = ivec2(floor(world));
  bool inside = cell.x >= 0 && cell.y >= 0 &&
    float(cell.x) < uBoardSize.x && float(cell.y) < uBoardSize.y;

  float alive = 0.0;
  if (inside) {
    alive = texelFetch(uState, cell, 0).r;
  }

  vec3 background = vec3(0.02, 0.03, 0.07);
  vec3 deadCell = vec3(0.07, 0.10, 0.18);
  vec3 aliveCell = vec3(0.31, 0.94, 0.55);
  vec3 color = inside ? mix(deadCell, aliveCell, alive) : background;

  if (inside && uGridOpacity > 0.0) {
    vec2 gridDistance = abs(fract(world) - 0.5);
    float edgeDistance = max(gridDistance.x, gridDistance.y);
    float line = 1.0 - smoothstep(0.46, 0.5, edgeDistance);
    color = mix(color, vec3(0.92), line * uGridOpacity * (1.0 - alive * 0.75));
  }

  outColor = vec4(color, 1.0);
}
`

const DEFAULT_RANDOM_DENSITY = 0.18
const DEFAULT_STEP_RATE = 12
const MIN_ZOOM = 0.25
const MAX_ZOOM = 64

class GpuLifeSimulation {
  readonly width: number
  readonly height: number
  private readonly gl: WebGL2RenderingContext
  private currentIndex = 0
  private readonly textures: WebGLTexture[]
  private readonly framebuffers: WebGLFramebuffer[]
  private readonly stepProgram: WebGLProgram
  private readonly stateLocation: WebGLUniformLocation
  private readonly sizeLocation: WebGLUniformLocation
  private readonly resetProgram: WebGLProgram
  private readonly resetSeedLocation: WebGLUniformLocation
  private readonly resetDensityLocation: WebGLUniformLocation

  constructor(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    vertexShaderSource: string,
    stepFragmentShaderSource: string,
    resetFragmentShaderSource: string,
  ) {
    this.gl = gl
    this.width = width
    this.height = height
    this.stepProgram = createProgram(gl, vertexShaderSource, stepFragmentShaderSource)
    this.stateLocation = getUniformLocation(gl, this.stepProgram, 'uState')
    this.sizeLocation = getUniformLocation(gl, this.stepProgram, 'uBoardSize')
    this.resetProgram = createProgram(gl, vertexShaderSource, resetFragmentShaderSource)
    this.resetSeedLocation = getUniformLocation(gl, this.resetProgram, 'uSeed')
    this.resetDensityLocation = getUniformLocation(gl, this.resetProgram, 'uDensity')
    this.textures = [createStateTexture(gl, width, height), createStateTexture(gl, width, height)]
    this.framebuffers = this.textures.map((texture) => createFramebuffer(gl, texture))
  }

  get currentTexture(): WebGLTexture {
    return this.textures[this.currentIndex]
  }

  get currentFramebuffer(): WebGLFramebuffer {
    return this.framebuffers[this.currentIndex]
  }

  step(vao: WebGLVertexArrayObject): void {
    const nextIndex = 1 - this.currentIndex

    this.gl.useProgram(this.stepProgram)
    this.gl.bindVertexArray(vao)
    this.gl.viewport(0, 0, this.width, this.height)
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffers[nextIndex])
    this.gl.activeTexture(this.gl.TEXTURE0)
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures[this.currentIndex])
    this.gl.uniform1i(this.stateLocation, 0)
    this.gl.uniform2i(this.sizeLocation, this.width, this.height)
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3)

    this.currentIndex = nextIndex
  }

  resetRandom(density: number, vao: WebGLVertexArrayObject): void {
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0
    this.gl.useProgram(this.resetProgram)
    this.gl.bindVertexArray(vao)
    this.gl.viewport(0, 0, this.width, this.height)
    this.gl.uniform1ui(this.resetSeedLocation, seed)
    this.gl.uniform1f(this.resetDensityLocation, density)
    for (const framebuffer of this.framebuffers) {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer)
      this.gl.drawArrays(this.gl.TRIANGLES, 0, 3)
    }
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null)
  }

  clear(): void {
    this.uploadState(new Uint8Array(this.width * this.height))
  }

  readCell(x: number, y: number): boolean {
    const pixel = new Uint8Array(1)
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.currentFramebuffer)
    this.gl.readPixels(x, y, 1, 1, this.gl.RED, this.gl.UNSIGNED_BYTE, pixel)
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null)
    return pixel[0] > 127
  }

  setCell(x: number, y: number, alive: boolean): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return
    }

    const value = new Uint8Array([alive ? 255 : 0])
    for (const texture of this.textures) {
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture)
      this.gl.texSubImage2D(
        this.gl.TEXTURE_2D,
        0,
        x,
        y,
        1,
        1,
        this.gl.RED,
        this.gl.UNSIGNED_BYTE,
        value,
      )
    }
  }

  private uploadState(data: Uint8Array): void {
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1)
    for (const texture of this.textures) {
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture)
      this.gl.texSubImage2D(
        this.gl.TEXTURE_2D,
        0,
        0,
        0,
        this.width,
        this.height,
        this.gl.RED,
        this.gl.UNSIGNED_BYTE,
        data,
      )
    }
  }
}

export class LifeGameApp {
  private readonly ui: UiElements
  private readonly gl: WebGL2RenderingContext
  private readonly simulation: GpuLifeSimulation
  private readonly drawProgram: WebGLProgram
  private readonly vao: WebGLVertexArrayObject
  private readonly drawStateLocation: WebGLUniformLocation
  private readonly drawCanvasLocation: WebGLUniformLocation
  private readonly drawBoardLocation: WebGLUniformLocation
  private readonly drawCameraLocation: WebGLUniformLocation
  private readonly drawZoomLocation: WebGLUniformLocation
  private readonly drawGridLocation: WebGLUniformLocation
  private readonly boardSize: number
  private cameraCenter: WorldPoint
  private zoom = 8
  private generation = 0
  private running = false
  private activeMode: PointerMode = 'draw'
  private activePointerId: number | null = null
  private pointerAction: PointerMode | null = null
  private pointerOrigin: ScreenPoint | null = null
  private pointerWorld: WorldPoint | null = null
  private paintValue = true
  private paintedCells = new Set<string>()
  private accumulator = 0
  private previousFrameTime = 0
  private readonly stepInterval = 1000 / DEFAULT_STEP_RATE

  constructor(ui: UiElements) {
    this.ui = ui
    const gl = ui.canvas.getContext('webgl2', {
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    })

    if (!gl) {
      throw new Error('WebGL2 is required but not available in this browser')
    }

    this.gl = gl
    this.gl.disable(this.gl.BLEND)
    this.gl.disable(this.gl.DEPTH_TEST)

    const maxTextureSize = Number(this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE))
    this.boardSize = Math.min(4096, maxTextureSize)
    this.cameraCenter = {
      x: this.boardSize / 2,
      y: this.boardSize / 2,
    }

    this.vao = this.createFullscreenVertexArray()
    this.simulation = new GpuLifeSimulation(
      this.gl,
      this.boardSize,
      this.boardSize,
      FULLSCREEN_VERTEX_SHADER,
      STEP_FRAGMENT_SHADER,
      RESET_FRAGMENT_SHADER,
    )
    this.simulation.resetRandom(DEFAULT_RANDOM_DENSITY, this.vao)
    this.drawProgram = createProgram(this.gl, FULLSCREEN_VERTEX_SHADER, DRAW_FRAGMENT_SHADER)
    this.drawStateLocation = getUniformLocation(this.gl, this.drawProgram, 'uState')
    this.drawCanvasLocation = getUniformLocation(this.gl, this.drawProgram, 'uCanvasSize')
    this.drawBoardLocation = getUniformLocation(this.gl, this.drawProgram, 'uBoardSize')
    this.drawCameraLocation = getUniformLocation(this.gl, this.drawProgram, 'uCameraCenter')
    this.drawZoomLocation = getUniformLocation(this.gl, this.drawProgram, 'uZoom')
    this.drawGridLocation = getUniformLocation(this.gl, this.drawProgram, 'uGridOpacity')

    this.registerEvents()
    this.resize()
    this.updateUi()
    requestAnimationFrame((time) => this.frame(time))
  }

  private createFullscreenVertexArray(): WebGLVertexArrayObject {
    const vao = this.gl.createVertexArray()
    if (!vao) {
      throw new Error('Failed to create a vertex array object')
    }
    this.gl.bindVertexArray(vao)
    return vao
  }

  private registerEvents(): void {
    window.addEventListener('resize', () => this.resize())
    this.ui.canvas.addEventListener('contextmenu', (event) => event.preventDefault())
    this.ui.canvas.addEventListener('wheel', (event) => this.onWheel(event), { passive: false })
    this.ui.canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event))
    this.ui.canvas.addEventListener('pointermove', (event) => this.onPointerMove(event))
    this.ui.canvas.addEventListener('pointerup', (event) => this.onPointerUp(event))
    this.ui.canvas.addEventListener('pointercancel', (event) => this.onPointerUp(event))

    this.ui.runButton.addEventListener('click', () => {
      this.running = !this.running
      this.updateUi()
    })
    this.ui.stepButton.addEventListener('click', () => {
      this.running = false
      this.stepSimulation()
      this.updateUi()
    })
    this.ui.resetButton.addEventListener('click', () => {
      this.running = false
      this.generation = 0
      this.simulation.resetRandom(DEFAULT_RANDOM_DENSITY, this.vao)
      this.updateUi()
      this.render()
    })
    this.ui.clearButton.addEventListener('click', () => {
      this.running = false
      this.generation = 0
      this.simulation.clear()
      this.updateUi()
      this.render()
    })
    this.ui.zoomInButton.addEventListener('click', () => this.zoomAtCanvasCenter(1.25))
    this.ui.zoomOutButton.addEventListener('click', () => this.zoomAtCanvasCenter(0.8))
    this.ui.modeButton.addEventListener('click', () => {
      this.activeMode = this.activeMode === 'draw' ? 'pan' : 'draw'
      this.updateUi()
    })
  }

  private resize(): void {
    const bounds = this.ui.canvas.getBoundingClientRect()
    const devicePixelRatio = window.devicePixelRatio || 1
    const width = Math.max(1, Math.round(bounds.width * devicePixelRatio))
    const height = Math.max(1, Math.round(bounds.height * devicePixelRatio))

    if (this.ui.canvas.width !== width || this.ui.canvas.height !== height) {
      this.ui.canvas.width = width
      this.ui.canvas.height = height
    }

    this.render()
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault()

    const bounds = this.ui.canvas.getBoundingClientRect()
    const screenPoint = {
      x: (event.clientX - bounds.left) * (this.ui.canvas.width / bounds.width),
      y: (bounds.bottom - event.clientY) * (this.ui.canvas.height / bounds.height),
    }
    const zoomFactor = event.deltaY < 0 ? 1.1 : 1 / 1.1
    this.zoomAroundPoint(zoomFactor, screenPoint)
  }

  private onPointerDown(event: PointerEvent): void {
    if (this.activePointerId !== null) {
      return
    }

    const screenPoint = this.toCanvasScreenPoint(event)
    this.activePointerId = event.pointerId
    this.pointerOrigin = screenPoint
    this.pointerWorld = { ...this.cameraCenter }
    this.pointerAction = this.shouldPan(event) ? 'pan' : 'draw'
    this.paintedCells.clear()

    this.ui.canvas.setPointerCapture(event.pointerId)
    this.ui.canvas.classList.toggle('panning', this.pointerAction === 'pan')

    if (this.pointerAction === 'draw') {
      const cell = this.screenToCell(screenPoint)
      if (!cell) {
        return
      }

      this.paintValue = !this.simulation.readCell(cell.x, cell.y)
      this.paintCell(cell.x, cell.y)
      this.render()
    }
  }

  private onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== this.activePointerId || !this.pointerAction || !this.pointerOrigin) {
      return
    }

    const screenPoint = this.toCanvasScreenPoint(event)

    if (this.pointerAction === 'pan') {
      const deltaX = screenPoint.x - this.pointerOrigin.x
      const deltaY = screenPoint.y - this.pointerOrigin.y
      if (this.pointerWorld) {
        this.cameraCenter = {
          x: this.pointerWorld.x - deltaX / this.zoom,
          y: this.pointerWorld.y - deltaY / this.zoom,
        }
      }
      this.render()
      return
    }

    const cell = this.screenToCell(screenPoint)
    if (!cell) {
      return
    }

    this.paintCell(cell.x, cell.y)
    this.render()
  }

  private onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== this.activePointerId) {
      return
    }

    this.activePointerId = null
    this.pointerAction = null
    this.pointerOrigin = null
    this.pointerWorld = null
    this.paintedCells.clear()
    this.ui.canvas.classList.remove('panning')
    this.ui.canvas.releasePointerCapture(event.pointerId)
  }

  private shouldPan(event: PointerEvent): boolean {
    return this.activeMode === 'pan' || event.shiftKey || event.button === 1 || event.button === 2
  }

  private toCanvasScreenPoint(event: PointerEvent): ScreenPoint {
    const bounds = this.ui.canvas.getBoundingClientRect()
    return {
      x: (event.clientX - bounds.left) * (this.ui.canvas.width / bounds.width),
      y: (bounds.bottom - event.clientY) * (this.ui.canvas.height / bounds.height),
    }
  }

  private screenToCell(point: ScreenPoint): { x: number; y: number } | null {
    const world = this.screenToWorld(point)
    const x = Math.floor(world.x)
    const y = Math.floor(world.y)
    if (x < 0 || y < 0 || x >= this.boardSize || y >= this.boardSize) {
      return null
    }
    return { x, y }
  }

  private screenToWorld(point: ScreenPoint): WorldPoint {
    return {
      x: (point.x - this.ui.canvas.width / 2) / this.zoom + this.cameraCenter.x,
      y: (point.y - this.ui.canvas.height / 2) / this.zoom + this.cameraCenter.y,
    }
  }

  private paintCell(x: number, y: number): void {
    const key = `${x}:${y}`
    if (this.paintedCells.has(key)) {
      return
    }
    this.paintedCells.add(key)
    this.simulation.setCell(x, y, this.paintValue)
  }

  private zoomAtCanvasCenter(factor: number): void {
    this.zoomAroundPoint(factor, {
      x: this.ui.canvas.width / 2,
      y: this.ui.canvas.height / 2,
    })
  }

  private zoomAroundPoint(factor: number, point: ScreenPoint): void {
    const before = this.screenToWorld(point)
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM)
    const after = this.screenToWorld(point)
    this.cameraCenter = {
      x: this.cameraCenter.x + (before.x - after.x),
      y: this.cameraCenter.y + (before.y - after.y),
    }
    this.updateUi()
    this.render()
  }

  private stepSimulation(): void {
    this.simulation.step(this.vao)
    this.generation += 1
    this.render()
  }

  private frame(time: number): void {
    if (this.previousFrameTime === 0) {
      this.previousFrameTime = time
    }

    const elapsed = time - this.previousFrameTime
    this.previousFrameTime = time

    if (this.running) {
      this.accumulator += elapsed
      let iterationCount = 0

      while (this.accumulator >= this.stepInterval && iterationCount < 4) {
        this.simulation.step(this.vao)
        this.generation += 1
        this.accumulator -= this.stepInterval
        iterationCount += 1
      }
    } else {
      this.accumulator = 0
    }

    this.updateUi()
    this.render()
    requestAnimationFrame((nextTime) => this.frame(nextTime))
  }

  private render(): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null)
    this.gl.viewport(0, 0, this.ui.canvas.width, this.ui.canvas.height)
    this.gl.useProgram(this.drawProgram)
    this.gl.bindVertexArray(this.vao)
    this.gl.activeTexture(this.gl.TEXTURE0)
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.simulation.currentTexture)
    this.gl.uniform1i(this.drawStateLocation, 0)
    this.gl.uniform2f(this.drawCanvasLocation, this.ui.canvas.width, this.ui.canvas.height)
    this.gl.uniform2f(this.drawBoardLocation, this.boardSize, this.boardSize)
    this.gl.uniform2f(this.drawCameraLocation, this.cameraCenter.x, this.cameraCenter.y)
    this.gl.uniform1f(this.drawZoomLocation, this.zoom)
    this.gl.uniform1f(this.drawGridLocation, this.zoom >= 10 ? Math.min((this.zoom - 10) / 18, 0.33) : 0)
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3)
  }

  private updateUi(): void {
    this.ui.runButton.textContent = this.running ? 'Pause' : 'Start'
    this.ui.modeButton.textContent = `Mode: ${this.activeMode === 'draw' ? 'Draw' : 'Pan'}`
    this.ui.generationLabel.textContent = `Generation: ${this.generation.toLocaleString()}`
    this.ui.zoomLabel.textContent = `Zoom: ${this.zoom.toFixed(2)}x`
    this.ui.boardLabel.textContent = `Board: ${this.boardSize} × ${this.boardSize}`
    this.ui.canvas.classList.toggle('pan-mode', this.activeMode === 'pan')
  }
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()

  if (!program) {
    throw new Error('Failed to create a WebGL program')
  }

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    throw new Error(`Failed to link WebGL program: ${info}`)
  }

  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)
  return program
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) {
    throw new Error('Failed to create a WebGL shader')
  }

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Failed to compile shader: ${info}`)
  }

  return shader
}

function createStateTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): WebGLTexture {
  const texture = gl.createTexture()

  if (!texture) {
    throw new Error('Failed to create a simulation texture')
  }

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, width, height)
  return texture
}

function createFramebuffer(gl: WebGL2RenderingContext, texture: WebGLTexture): WebGLFramebuffer {
  const framebuffer = gl.createFramebuffer()

  if (!framebuffer) {
    throw new Error('Failed to create a framebuffer')
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)

  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('Simulation framebuffer is incomplete')
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return framebuffer
}

function getUniformLocation(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name)
  if (location === null) {
    throw new Error(`Unable to find uniform: ${name}`)
  }
  return location
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
