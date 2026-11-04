import denghuo from "../assets/plans/denghuo.svg";
import yanhuo from "../assets/plans/yanhuo.svg";
import zhuhuo from "../assets/plans/zhuhuo.svg";

const MARKS: Record<string, { src: string; label: string }> = {
  candle: { src: zhuhuo, label: "烛火" },
  lamp: { src: denghuo, label: "灯火" },
  flame: { src: yanhuo, label: "焰火" },
  烛火: { src: zhuhuo, label: "烛火" },
  灯火: { src: denghuo, label: "灯火" },
  焰火: { src: yanhuo, label: "焰火" },
};

/** 月租档位标识；装饰性图形，文案仍由旁边的套餐名承担 */
export function PlanMark({
  plan,
  size,
  className = "",
}: {
  plan: string;
  /** 省略时由 CSS 控制（设置账号行用 1em） */
  size?: number;
  className?: string;
}) {
  const mark = MARKS[String(plan || "").trim()];
  if (!mark) return null;
  return (
    <img
      className={`plan-mark${className ? ` ${className}` : ""}`}
      src={mark.src}
      width={size ?? 16}
      height={size ?? 16}
      alt=""
      draggable={false}
      aria-hidden="true"
      style={size ? { width: size, height: size } : undefined}
    />
  );
}

export function planMarkSrc(plan: string): string | null {
  return MARKS[String(plan || "").trim()]?.src ?? null;
}
