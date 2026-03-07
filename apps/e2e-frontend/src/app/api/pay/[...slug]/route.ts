import { toNextJsHandler } from "paykitjs/handlers/next-js";

import { paykit } from "@/server/paykit";

export const { GET, POST } = toNextJsHandler(paykit);
