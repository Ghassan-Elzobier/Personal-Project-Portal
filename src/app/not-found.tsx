import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-md">
      <div className="space-y-4 card p-8">
        <h1 className="text-2xl font-bold">Nothing here</h1>
        <p className="subtext">This page doesn&apos;t exist, or it isn&apos;t shared with you.</p>
        <Link href="/" className="btn-ghost">
          Go home
        </Link>
      </div>
    </div>
  );
}
