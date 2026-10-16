// Next looks for the PostCSS config in the project directory, i.e. here.
// Tailwind then finds tailwind.config.ts in the working directory, which is
// the repository root as long as the build runs through `npm run build:demo`.
export { default } from "../postcss.config.mjs";
