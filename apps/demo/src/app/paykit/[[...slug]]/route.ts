import { paykitHandler } from "paykitjs/handlers/next";

import { paykit } from "@/lib/paykit";

export const { GET, POST } = paykitHandler(paykit);
