import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Clario360 — four suites on one sovereign platform core';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

// Clario360 brand mark (light variant) as a data URI for the Satori <img>.
const MARK_DATA_URI =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA4MCA4MCI+PGNpcmNsZSBjeD0iNDAiIGN5PSI0MCIgcj0iMzIiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI0ZERkZGNiIgc3Ryb2tlLXdpZHRoPSI4Ii8+PGNpcmNsZSBjeD0iNDAiIGN5PSI0MCIgcj0iMjIiIGZpbGw9IiNBQkI3MDUiLz48Y2lyY2xlIGN4PSI0MCIgY3k9IjQwIiByPSIxMCIgZmlsbD0iIzAwNUU1RSIvPjxwYXRoIGQ9Ik0xNCAyOWg1Mk0xMCA0MGg2ME0xNCA1MWg1MiIgc3Ryb2tlPSIjMDA1RTVFIiBzdHJva2Utd2lkdGg9IjQiLz48L3N2Zz4=';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: 'stretch',
          background: '#005E5E',
          color: '#FFFFFF',
          display: 'flex',
          fontFamily: 'Inter, "Segoe UI", Arial, sans-serif',
          height: '100%',
          justifyContent: 'space-between',
          padding: 64,
          width: '100%',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: '62%',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div
              style={{
                alignItems: 'center',
                display: 'flex',
                gap: 16,
                fontSize: 38,
                fontWeight: 800,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={MARK_DATA_URI} width={56} height={56} alt="" />
              Clario360
            </div>
            <div
              style={{
                color: '#ABB705',
                display: 'flex',
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: 'uppercase',
              }}
            >
              Sovereign enterprise platform
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                fontSize: 72,
                fontWeight: 800,
                gap: 4,
                lineHeight: 1.04,
              }}
            >
              <span>One platform.</span>
              <span>Four suites.</span>
              <span>Sovereign by design.</span>
            </div>
          </div>
          <div
            style={{
              color: 'rgba(255,255,255,0.76)',
              display: 'flex',
              fontSize: 27,
            }}
          >
            Arabic-first · SaaS · on-premise · fully air-gapped
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            justifyContent: 'center',
            width: '32%',
          }}
        >
          {[
            ['DataStream', '#0E6E7A'],
            ['Business+', '#ABB705'],
            ['ClarioSec', '#B23A48'],
            ['ClarioInsight', '#5B3FA8'],
          ].map(([label, color]) => (
            <div
              key={label}
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.22)',
                borderRadius: 22,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                padding: 22,
              }}
            >
              <div
                style={{
                  background: color,
                  borderRadius: 999,
                  height: 10,
                  width: 72,
                }}
              />
              <div style={{ display: 'flex', fontSize: 30, fontWeight: 800 }}>
                {label}
              </div>
              <div
                style={{
                  color: 'rgba(255,255,255,0.68)',
                  display: 'flex',
                  fontSize: 18,
                }}
              >
                One login · one audit · one core
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
