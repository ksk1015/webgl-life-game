import './style.css'
import { LifeGameApp } from './webgl-life-game.ts'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="app-shell">
    <header class="toolbar">
      <div class="toolbar-group">
        <button type="button" data-action="toggle-run">Start</button>
        <button type="button" data-action="step">Step</button>
        <button type="button" data-action="reset">Reset</button>
        <button type="button" data-action="clear">Clear</button>
      </div>
      <div class="toolbar-group">
        <button type="button" data-action="zoom-out">−</button>
        <button type="button" data-action="zoom-in">+</button>
        <button type="button" data-action="toggle-mode">Mode: Draw</button>
      </div>
      <div class="toolbar-status">
        <span data-role="generation">Generation: 0</span>
        <span data-role="zoom">Zoom: 8.00x</span>
        <span data-role="board">Board: --</span>
      </div>
    </header>
    <main class="stage">
      <canvas aria-label="WebGL Life Game board"></canvas>
      <aside class="help-panel">
        <h1>WebGL Life Game</h1>
        <ul>
          <li>Draw mode: click / drag to paint cells</li>
          <li>Pan mode or Shift + drag: move around the board</li>
          <li>Wheel or +/-: zoom in and out</li>
          <li>Right-drag also pans without changing mode</li>
        </ul>
      </aside>
    </main>
  </div>
`

const canvas = document.querySelector<HTMLCanvasElement>('canvas')
const runButton = document.querySelector<HTMLButtonElement>('[data-action="toggle-run"]')
const stepButton = document.querySelector<HTMLButtonElement>('[data-action="step"]')
const resetButton = document.querySelector<HTMLButtonElement>('[data-action="reset"]')
const clearButton = document.querySelector<HTMLButtonElement>('[data-action="clear"]')
const zoomInButton = document.querySelector<HTMLButtonElement>('[data-action="zoom-in"]')
const zoomOutButton = document.querySelector<HTMLButtonElement>('[data-action="zoom-out"]')
const modeButton = document.querySelector<HTMLButtonElement>('[data-action="toggle-mode"]')
const generationLabel = document.querySelector<HTMLElement>('[data-role="generation"]')
const zoomLabel = document.querySelector<HTMLElement>('[data-role="zoom"]')
const boardLabel = document.querySelector<HTMLElement>('[data-role="board"]')

if (
  !canvas ||
  !runButton ||
  !stepButton ||
  !resetButton ||
  !clearButton ||
  !zoomInButton ||
  !zoomOutButton ||
  !modeButton ||
  !generationLabel ||
  !zoomLabel ||
  !boardLabel
) {
  throw new Error('Failed to initialize the application UI')
}

new LifeGameApp({
  canvas,
  runButton,
  stepButton,
  resetButton,
  clearButton,
  zoomInButton,
  zoomOutButton,
  modeButton,
  generationLabel,
  zoomLabel,
  boardLabel,
})
