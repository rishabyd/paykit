import { createPayKitClient } from "paykitjs/client";

import type { paykit } from "@/lib/paykit";

export const paykitClient = createPayKitClient<typeof paykit>();
