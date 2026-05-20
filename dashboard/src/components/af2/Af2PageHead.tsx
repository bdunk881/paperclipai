import type { ReactNode } from "react";
import { Af2Eyebrow } from "./Af2Eyebrow";
import { Af2H1 } from "./Af2Heading";

export interface Af2PageHeadProps {
  eyebrow: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  subtitle?: ReactNode;
}

/**
 * v2 page head — eyebrow + h1 + optional inline actions on the right and an
 * optional subtitle row below. Compresses the four-line pattern repeated on
 * every v2 page into one component:
 *
 *   <div className="af2-eyebrow">Run · Home</div>
 *   <h1 className="af2-h1 font-af2-serif" style={{ marginTop: 6 }}>...</h1>
 */
export function Af2PageHead({ eyebrow, title, actions, subtitle }: Af2PageHeadProps) {
  return (
    <div className="af2-page-head">
      <div>
        <Af2Eyebrow>{eyebrow}</Af2Eyebrow>
        <Af2H1>{title}</Af2H1>
        {subtitle ? <div className="af2-page-head-meta">{subtitle}</div> : null}
      </div>
      {actions ? <div className="af2-page-actions">{actions}</div> : null}
    </div>
  );
}
