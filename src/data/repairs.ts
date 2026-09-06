export interface RepairService {
  title: string;
  price: string;
  description: string;
}

export const phoneRepairs: RepairService[] = [
  { title: "Screen Replacement", price: "From £39", description: "Cracked or shattered screens replaced with high-quality parts." },
  { title: "Battery Replacement", price: "From £29", description: "Restore your battery life with a genuine-quality replacement." },
  { title: "Charging Port Repair", price: "From £29", description: "Fix charging issues, loose connections and slow charging." },
  { title: "Water Damage Treatment", price: "From £35", description: "Professional diagnosis and cleaning for liquid-damaged devices." },
  { title: "Camera Repair", price: "From £35", description: "Blurry, cracked or non-working cameras fixed fast." },
  { title: "Software Troubleshooting", price: "From £20", description: "Freezing, crashing or software issues diagnosed and resolved." },
];

export const tabletRepairs: RepairService[] = [
  { title: "iPad Screen Repair", price: "From £59", description: "Cracked iPad and tablet screens replaced professionally." },
  { title: "Tablet Battery Replacement", price: "From £45", description: "Bring your tablet's battery life back to full strength." },
  { title: "Charging & Port Issues", price: "From £35", description: "Diagnosis and repair of charging port faults." },
  { title: "Software & Data Issues", price: "From £25", description: "Software resets, updates and troubleshooting." },
];

export const tvRepairs: RepairService[] = [
  { title: "Screen & Display Faults", price: "From £49", description: "Lines, flickering or blank screens diagnosed and repaired." },
  { title: "Power & No-Start Issues", price: "From £39", description: "TVs that won't switch on or keep restarting." },
  { title: "Sound Problems", price: "From £29", description: "No sound, crackling or distorted audio fixed." },
  { title: "Smart TV Software Issues", price: "From £25", description: "App crashes, freezing and connectivity problems resolved." },
];

export const deviceTypes = ["Mobile Phone", "iPad", "Tablet", "TV", "Other"];
export const deviceBrands = [
  "Apple",
  "Samsung",
  "Google",
  "OnePlus",
  "Huawei",
  "Xiaomi",
  "Sony",
  "LG",
  "Other",
];
