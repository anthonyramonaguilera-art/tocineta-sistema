import React, { useState, useEffect } from 'react';

export const FAITH_MESSAGES = [
  '✨ Dios es amor · En Sus manos está este negocio',
  '🙏 Cristo te ama · Cocinamos con amor y damos gloria a Dios',
  '🙌 Dios es bueno en todo tiempo · Bendecidos para servirte',
  '💛 Todo lo puedo en Cristo que me fortalece (Filipenses 4:13)',
  '👑 A Dios sea toda la honra y toda la gloria'
];

export const FaithBanner: React.FC = () => {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex(prev => (prev + 1) % FAITH_MESSAGES.length);
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="bg-[#0B0D11] border-b border-[#FFE600]/30 text-[#FFE600] text-xs font-bold py-1 text-center transition-all duration-500 tracking-wide select-none">
      {FAITH_MESSAGES[index]}
    </div>
  );
};
