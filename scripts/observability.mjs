import {fileURLToPath} from 'node:url';

export const observabilityBuildOptions={
 entryPoints:[fileURLToPath(new URL('../assets/observability.js',import.meta.url))],
 bundle:true,format:'esm',platform:'browser',target:'es2020',minify:true,
 define:{'process.env.NODE_ENV':'"production"'}
};
