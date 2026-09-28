import tseslint from "typescript-eslint";
const config = tseslint.config(...tseslint.configs.recommended, { ignores: ["dist/**"] });
export default config;
