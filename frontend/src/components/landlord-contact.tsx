import { Mail, MessageCircle, Phone } from "lucide-react";

export type LandlordContact = { phone?: string | null; email?: string | null } | null;

// Unlocked phone/email from ListingSerializer.landlord_contact — the
// backend only returns it once the viewer has access, so this never
// renders gated data on its own.
export function ContactReveal({ contact }: { contact: LandlordContact }) {
  const phone = contact?.phone?.trim() || null;
  const email = contact?.email?.trim() || null;
  const whatsapp = phone ? phone.replace(/[^\d]/g, "").replace(/^0/, "233") : null;

  if (!phone && !email) {
    return (
      <p className="animate-in fade-in slide-in-from-top-1 rounded-md bg-zinc-50 p-3 text-xs text-black/70">
        The landlord hasn&apos;t added contact details yet.
      </p>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-top-1 space-y-1.5 rounded-md bg-zinc-50 p-2 duration-200">
      {phone && (
        <a
          href={`tel:${phone}`}
          className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-zinc-100"
        >
          <Phone className="size-4" /> {phone}
        </a>
      )}
      {whatsapp && (
        <a
          href={`https://wa.me/${whatsapp}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-zinc-100"
        >
          <MessageCircle className="size-4" /> WhatsApp
        </a>
      )}
      {email && (
        <a
          href={`mailto:${email}`}
          className="flex items-center gap-2 truncate rounded px-2 py-1.5 text-sm hover:bg-zinc-100"
        >
          <Mail className="size-4 shrink-0" /> <span className="truncate">{email}</span>
        </a>
      )}
    </div>
  );
}
