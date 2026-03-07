export default function CheckoutSuccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-16 text-white">
      <div className="flex max-w-xl flex-col gap-4 rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-8">
        <p className="text-sm tracking-[0.3em] text-emerald-200/80 uppercase">
          PayKit E2E frontend
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">Checkout success</h1>
        <p className="text-base text-white/80">
          Stripe redirected back successfully. If webhook forwarding is configured, PayKit should
          also log a normalized <code>checkout.completed</code> event on the server.
        </p>
      </div>
    </main>
  );
}
