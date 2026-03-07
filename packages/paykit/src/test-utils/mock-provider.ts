import { defineProvider } from "../providers/provider";

export function mockProvider() {
  return defineProvider({
    id: "mock",

    async upsertCustomer(data) {
      return { providerCustomerId: `mock_cus_${data.id}` };
    },

    async checkout() {
      return { url: "https://example.com/checkout/mock" };
    },

    async attachPaymentMethod(data) {
      return { url: data.returnURL };
    },

    async detachPaymentMethod() {},

    async handleWebhook() {
      return [];
    },
  });
}
