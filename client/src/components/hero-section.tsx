import { Button } from "@/components/ui/button";
import { Wifi } from "lucide-react";

interface HeroSectionProps {
  onApplyClick: () => void;
}

export default function HeroSection({ onApplyClick }: HeroSectionProps) {
  const scrollToPrograms = () => {
    const element = document.getElementById('programs');
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <section className="bg-primary py-20">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-4xl mx-auto">
          <h1 className="text-4xl md:text-6xl font-bold mb-6 text-white">
            2026 BNI Korea Leadership Training
          </h1>
          <p className="text-xl md:text-2xl text-white/90 mb-8 leading-relaxed">
            BNI 코리아의 리더십 트레이닝 프로그램으로 전문성을 키우고<br />
            네트워킹 스킬을 향상시키세요
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              onClick={scrollToPrograms}
              className="bni-button-secondary px-8 py-3 text-lg font-semibold transition-all transform hover:scale-105"
            >
              프로그램 보기
            </Button>
            <Button
              onClick={onApplyClick}
              variant="outline"
              className="border-white text-white hover:bg-white hover:text-primary px-8 py-3 text-lg font-semibold transition-all"
            >
              지금 신청하기
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
