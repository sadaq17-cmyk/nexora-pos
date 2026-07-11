import { Construction } from "lucide-react";

export default function ComingSoon({ title, description }) {
  return (
    <div className="animate-fadein">
      <h1 className="text-2xl font-bold text-[#1B2439] mb-1">{title}</h1>
      <p className="text-sm text-[#6B7690] mb-6">{description}</p>
      <div className="bg-white border border-dashed border-[#E4E9F2] rounded-2xl py-16 text-center">
        <Construction size={28} className="mx-auto mb-3 text-[#C9D2E3]" />
        <p className="text-sm font-medium text-[#1B2439]">Coming in the next build stage</p>
        <p className="text-xs text-[#6B7690] mt-1">The route and layout are already wired up — full functionality lands in the next stage.</p>
      </div>
    </div>
  );
}
