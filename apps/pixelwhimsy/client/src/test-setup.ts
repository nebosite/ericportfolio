import '@testing-library/jest-dom/vitest';

// jsdom has no real 2d canvas; the components guard a null context, so returning
// null keeps rendering quiet without pulling in the native canvas package.
HTMLCanvasElement.prototype.getContext = (() =>
  null) as typeof HTMLCanvasElement.prototype.getContext;
