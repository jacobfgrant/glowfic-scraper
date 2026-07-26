// The converter runs against a real DOM in the browser, so tests use one too.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;

export function parse(html) {
  return new JSDOM(html).window.document;
}
