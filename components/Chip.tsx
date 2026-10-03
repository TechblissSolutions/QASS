'use client';
import { colorFor } from '@/lib/constants';
export default function Chip({ channel }: { channel: string }) { const [c,soft]=colorFor(channel); return <span className="ch" style={{'--c':c,'--c-soft':soft} as React.CSSProperties}>{channel}</span>; }
