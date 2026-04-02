"use client";

interface PipMascotProps {
  size?: number;
  dancing?: boolean;
  spinning?: boolean;
  className?: string;
}

export default function PipMascot({
  size = 120,
  dancing = false,
  spinning = false,
  className = "",
}: PipMascotProps) {
  return (
    <div
      className={`inline-block ${dancing ? "animate-pip-dance" : ""} ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 120 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
      >
        {/* Light trails behind Pip */}
        <g opacity="0.6">
          <path
            d="M10 80 Q25 75 30 65"
            stroke="#FFD93D"
            strokeWidth="3"
            strokeLinecap="round"
            className="flow-line"
          />
          <path
            d="M8 90 Q20 85 25 78"
            stroke="#00D4B8"
            strokeWidth="2"
            strokeLinecap="round"
            style={{ animationDelay: "0.3s" }}
            className="flow-line"
          />
          <path
            d="M12 70 Q22 68 26 60"
            stroke="#4A3AFF"
            strokeWidth="2"
            strokeLinecap="round"
            style={{ animationDelay: "0.6s" }}
            className="flow-line"
          />
        </g>

        {/* Body — rounded robot shape in Teal */}
        <rect
          x="30"
          y="45"
          width="60"
          height="55"
          rx="18"
          fill="#00D4B8"
        />

        {/* Teal body highlight */}
        <rect
          x="35"
          y="50"
          width="25"
          height="15"
          rx="8"
          fill="rgba(255,255,255,0.2)"
        />

        {/* Head — Indigo accents */}
        <rect
          x="33"
          y="18"
          width="54"
          height="42"
          rx="16"
          fill="#4A3AFF"
        />

        {/* Head highlight */}
        <rect
          x="40"
          y="22"
          width="20"
          height="10"
          rx="5"
          fill="rgba(255,255,255,0.2)"
        />

        {/* Eyes — Sunshine Yellow */}
        <circle cx="47" cy="38" r="8" fill="#FFD93D" />
        <circle cx="73" cy="38" r="8" fill="#FFD93D" />
        {/* Pupils */}
        <circle cx="49" cy="38" r="3.5" fill="#0F1333" />
        <circle cx="75" cy="38" r="3.5" fill="#0F1333" />
        {/* Eye shine */}
        <circle cx="50.5" cy="36" r="1.5" fill="white" />
        <circle cx="76.5" cy="36" r="1.5" fill="white" />

        {/* Antenna */}
        <rect x="58" y="8" width="4" height="12" rx="2" fill="#4A3AFF" />
        <circle cx="60" cy="7" r="5" fill="#FFD93D" />
        <circle cx="60" cy="7" r="2.5" fill="#FF5F57" />

        {/* Smile */}
        <path
          d="M48 52 Q60 60 72 52"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />

        {/* Gear badge on chest */}
        <g transform="translate(53, 72)" className={spinning ? "animate-spin-slow" : ""} style={{ transformOrigin: "7px 7px" }}>
          <circle cx="7" cy="7" r="6" fill="#0F1333" />
          <circle cx="7" cy="7" r="3.5" fill="#FFD93D" />
          {/* Gear teeth */}
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => (
            <rect
              key={i}
              x="6"
              y="0.5"
              width="2"
              height="3"
              rx="0.5"
              fill="#0F1333"
              transform={`rotate(${angle} 7 7)`}
            />
          ))}
        </g>

        {/* Arms */}
        <rect x="16" y="55" width="16" height="8" rx="4" fill="#00D4B8" />
        <rect x="88" y="55" width="16" height="8" rx="4" fill="#00D4B8" />

        {/* Hands */}
        <circle cx="14" cy="59" r="5" fill="#4A3AFF" />
        <circle cx="106" cy="59" r="5" fill="#4A3AFF" />

        {/* Legs */}
        <rect x="42" y="95" width="14" height="18" rx="5" fill="#4A3AFF" />
        <rect x="64" y="95" width="14" height="18" rx="5" fill="#4A3AFF" />

        {/* Feet */}
        <ellipse cx="49" cy="114" rx="9" ry="5" fill="#0F1333" />
        <ellipse cx="71" cy="114" rx="9" ry="5" fill="#0F1333" />
      </svg>
    </div>
  );
}
