import { defineConfig } from 'vite'

const githubPagesBasePath = process.env.GITHUB_PAGES_BASE_PATH
const normalizedGithubPagesBase =
  githubPagesBasePath && githubPagesBasePath.length > 0
    ? `${githubPagesBasePath.replace(/\/$/, '')}/`
    : '/'

export default defineConfig({
  base: process.env.GITHUB_ACTIONS === 'true' ? normalizedGithubPagesBase : '/',
})
