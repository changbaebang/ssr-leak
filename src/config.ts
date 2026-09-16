import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Config, ConfigError, type GuardSources, type TaintSources } from './types.js';

export const CONFIG_FILE_NAMES: readonly string[] = [
  'ssr-leak.config.json',
  'ssr-leak.config.mjs',
  'ssr-leak.config.js',
  'ssr-leak.config.cjs',
];

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates an unknown value as a config object. Throws `ConfigError` with a precise message. */
export function validateConfig(raw: unknown, source = 'config'): Config {
  if (!isObject(raw)) throw new ConfigError(`${source}: expected an object`);
  const config: Config = {};
  const unknownKeys = Object.keys(raw).filter(
    (k) => !['ignore', 'exclude', 'include', 'taintSources', 'guards'].includes(k),
  );
  if (unknownKeys.length > 0) {
    throw new ConfigError(`${source}: unknown key(s) ${unknownKeys.join(', ')}`);
  }
  for (const key of ['ignore', 'exclude', 'include'] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (!isStringArray(value)) throw new ConfigError(`${source}: "${key}" must be string[]`);
    config[key] = value;
  }
  if (raw.taintSources !== undefined) {
    if (!isObject(raw.taintSources)) {
      throw new ConfigError(`${source}: "taintSources" must be an object`);
    }
    const ts: TaintSources = {};
    const { functions, identifiers } = raw.taintSources;
    if (functions !== undefined) {
      if (!isStringArray(functions)) {
        throw new ConfigError(`${source}: "taintSources.functions" must be string[]`);
      }
      ts.functions = functions;
    }
    if (identifiers !== undefined) {
      if (!isStringArray(identifiers)) {
        throw new ConfigError(`${source}: "taintSources.identifiers" must be string[]`);
      }
      ts.identifiers = identifiers;
    }
    config.taintSources = ts;
  }
  if (raw.guards !== undefined) {
    if (!isObject(raw.guards)) throw new ConfigError(`${source}: "guards" must be an object`);
    const guards: GuardSources = {};
    for (const key of ['server', 'client'] as const) {
      const value = raw.guards[key];
      if (value === undefined) continue;
      if (!isStringArray(value)) {
        throw new ConfigError(`${source}: "guards.${key}" must be string[]`);
      }
      guards[key] = value;
    }
    config.guards = guards;
  }
  return config;
}

export async function loadConfigFile(file: string): Promise<Config> {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new ConfigError(`config file not found: ${file}`);
  let raw: unknown;
  if (abs.endsWith('.json')) {
    try {
      raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (err) {
      throw new ConfigError(`${file}: invalid JSON (${(err as Error).message})`);
    }
  } else {
    let mod: unknown;
    try {
      mod = await import(pathToFileURL(abs).href);
    } catch (err) {
      throw new ConfigError(`${file}: failed to load (${(err as Error).message})`);
    }
    raw = isObject(mod) && 'default' in mod ? mod.default : mod;
  }
  return validateConfig(raw, file);
}

/** Finds `ssr-leak.config.*` in root. Returns `undefined` when none exists. */
export function findConfigFile(root: string): string | undefined {
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = path.join(root, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Resolves `config`: an object is validated; a path is loaded relative to `root`; otherwise `ssr-leak.config.*` in root. */
export async function resolveConfig(
  root: string,
  config: Config | string | undefined,
): Promise<{ config: Config; file?: string }> {
  if (typeof config === 'string') {
    const file = path.isAbsolute(config) ? config : path.resolve(root, config);
    return { config: await loadConfigFile(file), file };
  }
  if (config) return { config: validateConfig(config) };
  const file = findConfigFile(root);
  if (!file) return { config: {} };
  return { config: await loadConfigFile(file), file };
}
