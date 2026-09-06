const ADDRESS_QUERY = encodeURIComponent(
  "DGN Tech Mobiles, 10 Russell Hill Road, Purley, CR8 2LA"
);

export const DIRECTIONS_URL = `https://www.google.com/maps/dir/?api=1&destination=${ADDRESS_QUERY}`;
export const MAP_URL = `https://www.google.com/maps?q=${ADDRESS_QUERY}`;

export function MapEmbed({ className = "" }: { className?: string }) {
  return (
    <iframe
      title="DGN Tech Mobiles location on Google Maps"
      src={`https://www.google.com/maps?q=${ADDRESS_QUERY}&output=embed`}
      className={className}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}
