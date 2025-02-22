import type { Module, NuxtOptions } from '@nuxt/types'
import { resolve } from 'upath'
import type { Configuration } from 'webpack'

import { name, version } from '../../package.json'

import { registerBabelPlugin } from './babel-register'
import { addGlobalsFile } from './globals-register'
import { addResolvedTemplate, resolveCoreJsVersion } from './utils'

const compositionApiModule: Module<never> = function compositionApiModule() {
  const nuxt = this.nuxt as { options: NuxtOptions }

  // Register globals file where Nuxt config can be accessed from live library

  addGlobalsFile.call(this)

  // Force transpilation of this library (to enable resolution of globals file)

  const runtimeDir = resolve(__dirname, 'runtime')
  nuxt.options.build.transpile = nuxt.options.build.transpile || []
  nuxt.options.build.transpile.push('@nuxtjs/composition-api', runtimeDir)

  // Define vue resolution to prevent VCA being registered to the wrong Vue instance

  const vueEntry =
    nuxt.options.alias.vue ||
    (nuxt.options.dev
      ? this.nuxt.resolver.resolveModule('vue/dist/vue.common.dev.js')
      : this.nuxt.resolver.resolveModule('vue/dist/vue.runtime.esm.js'))

  const vueAliases = Object.fromEntries(
    [
      // vue 2 dist files
      '.common.dev',
      '.common',
      '.common.prod',
      '.esm.browser',
      '.esm.browser.min',
      '.esm',
      '',
      '.min',
      '.runtime.common.dev',
      '.runtime.common',
      '.runtime.common.prod',
      '.runtime.esm',
      '.runtime',
      '.runtime.min',
    ]
      .flatMap(m => [`vue/dist/vue${m}`, `vue/dist/vue${m}.js`])
      .map(m => [m, vueEntry])
  )

  nuxt.options.alias = {
    ...vueAliases,
    ...nuxt.options.alias,
    vue: vueEntry,
  }

  // Define @vue/composition-api resolution to prevent using different versions of @vue/composition-api

  const capiEntrypoint = '@vue/composition-api/dist/vue-composition-api.mjs'
  const capiResolution =
    nuxt.options.alias['@vue/composition-api'] ||
    this.nuxt.resolver.resolveModule(capiEntrypoint)

  const capiAliases = Object.fromEntries(
    ['.common', '', '.prod', '.common.prod', '.esm', '.mjs']
      .flatMap(m => [
        `@vue/composition-api/dist/vue-composition-api${m}`,
        `@vue/composition-api/dist/vue-composition-api${m}.js`,
      ])
      .map(m => [m, capiResolution])
  )

  nuxt.options.alias = {
    ...capiAliases,
    ...nuxt.options.alias,
    '@vue/composition-api': capiResolution,
  }

  // Define @nuxtjs/composition-api resolution to ensure plugins register global context successfully

  nuxt.options.alias['@nuxtjs/composition-api'] =
    nuxt.options.alias['@nuxtjs/composition-api'] ||
    this.nuxt.resolver
      .resolveModule('@nuxtjs/composition-api')
      .replace('.js', '.mjs')

  // Register the Vue Composition API for webpack

  const registration = addResolvedTemplate.call(this, 'register.mjs')
  this.nuxt.hook('webpack:config', (config: Configuration[]) => {
    config.forEach(config => {
      const entry = config.entry as Record<string, string[]>
      entry.app.unshift(registration)
    })
  })

  // Turn off webpack4 module context for .mjs files (as it appears to have some issues)

  this.extendBuild(config => {
    if (!config.module) return

    config.module.rules.forEach(rule => {
      if (rule.test instanceof RegExp && rule.test.test('index.mjs')) {
        rule.type = 'javascript/auto'
      }
    })

    config.module.rules.unshift({
      test: /\.mjs$/,
      type: 'javascript/auto',
      include: [/node_modules/],
    })
  })

  // If we're using nuxt-vite, register vite plugin & inject configuration

  const viteMiddleware = addResolvedTemplate.call(this, 'middleware.mjs')
  this.nuxt.hook('vite:extend', async (ctx: any) => {
    const { compositionApiPlugin } = await import('./vite-plugin')
    ctx.config.plugins.push(compositionApiPlugin())
    ctx.config.resolve.alias['./middleware.js'] = viteMiddleware
  })

  // If we're using Babel, register Babel plugin for injecting keys

  registerBabelPlugin.call(this)

  // Add appropriate corejs polyfill for IE support

  addResolvedTemplate.call(this, 'polyfill.client.mjs', {
    corejsPolyfill: resolveCoreJsVersion.call(this),
  })

  // Plugin to allow running onGlobalSetup
  const globalPlugin = addResolvedTemplate.call(this, 'plugin.mjs')

  // Allow setting head() within onGlobalSetup
  const metaPlugin = addResolvedTemplate.call(this, 'meta.mjs')

  this.nuxt.hook('modules:done', () => {
    nuxt.options.plugins.push(metaPlugin)
    nuxt.options.plugins.unshift(globalPlugin)
  })

  // Enable using `script setup`
  this.addModule('unplugin-vue2-script-setup/nuxt')

  if (!this.nuxt.options.capi?.disableMigrationWarning) {
    this.nuxt.hook('build:done', () => {
      console.info(
        "`Nuxt Bridge has now been released in beta.` It has full composition API support and it's strongly recommended to migrate from `@nuxtjs/composition-api`, if possible, by following the steps at `https://v3.nuxtjs.org/getting-started/bridge`. Feedback welcome at `https://github.com/nuxt-community/composition-api/discussions/585`.\n"
      )
    })
  }
}

// eslint-disable-next-line
// @ts-ignore
compositionApiModule.meta = {
  name,
  version,
}

export default compositionApiModule
