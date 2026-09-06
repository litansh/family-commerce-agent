// Monorepo safety net: expo is hoisted to the repo root, so expo/AppEntry
// resolves its `../../App` to THIS file. Re-export the real app so the entry
// works no matter which folder `expo start` is run from.
export { default } from './apps/mobile/App';
