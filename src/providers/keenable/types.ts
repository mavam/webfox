import type { Provider } from "../contract.js";

export interface Keenable extends Provider {
  baseUrl?: string;
}
