export default function CheckoutCancelPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-16 text-white">
      <div className="flex max-w-xl flex-col gap-4 rounded-3xl border border-amber-500/30 bg-amber-500/10 p-8">
        <p className="text-sm tracking-[0.3em] text-amber-100/80 uppercase">PayKit E2E frontend</p>
        <h1 className="text-4xl font-semibold tracking-tight">Checkout canceled</h1>
        <p className="text-base text-white/80">
          The hosted Stripe Checkout flow was canceled before completion.
        </p>
      </div>
    </main>
  );
}
