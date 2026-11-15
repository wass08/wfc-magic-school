/// <reference lib="webworker" />
import { ChunkJob, solveChunk } from './chunkSolve';

// solves infinite-world chunks off the main thread: the frame never waits on the WFC
self.onmessage = (e: MessageEvent<ChunkJob>) => {
  const r = solveChunk(e.data);
  (self as unknown as Worker).postMessage(r, [r.cells.buffer]);
};
