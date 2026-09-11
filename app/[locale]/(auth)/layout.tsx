import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { isLocale, type Locale } from '@kurdora/i18n';

/** Narrow, centred shell for the sign-in and sign-up flows. */
export default async function AuthLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale as Locale);

  return (
    <main id="main" className="mx-auto w-full max-w-md px-4 py-16 lg:px-8">
      {children}
    </main>
  );
}
