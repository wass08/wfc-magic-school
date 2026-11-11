// Importing the module files registers their builders.
import './modules';
import './extra';
import './blocks';
import './terraces';

export { moduleGeometry, BUILDERS } from './registry';
export type { ModuleGeometry } from './registry';
