/** Monochrome outline icons for shipping-label thermal bitmap. */

export type ShippingCanvasIcon =
  | 'boxes'
  | 'boxNumber'
  | 'dimensions'
  | 'contents'
  | 'weight'
  | 'transport'
  | 'payment'
  | 'branch'
  | 'destination'
  | 'time'
  | 'bookedBy';

export function drawShippingIcon(
  ctx: CanvasRenderingContext2D,
  kind: ShippingCanvasIcon,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  ctx.strokeStyle = '#111';
  ctx.fillStyle = '#111';
  ctx.lineWidth = Math.max(1.2, size * 0.1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const s = size;

  switch (kind) {
    case 'boxes': {
      // isometric cube
      ctx.beginPath();
      ctx.moveTo(x + s * 0.5, y + s * 0.12);
      ctx.lineTo(x + s * 0.88, y + s * 0.32);
      ctx.lineTo(x + s * 0.88, y + s * 0.72);
      ctx.lineTo(x + s * 0.5, y + s * 0.92);
      ctx.lineTo(x + s * 0.12, y + s * 0.72);
      ctx.lineTo(x + s * 0.12, y + s * 0.32);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + s * 0.5, y + s * 0.52);
      ctx.lineTo(x + s * 0.88, y + s * 0.32);
      ctx.moveTo(x + s * 0.5, y + s * 0.52);
      ctx.lineTo(x + s * 0.12, y + s * 0.32);
      ctx.moveTo(x + s * 0.5, y + s * 0.52);
      ctx.lineTo(x + s * 0.5, y + s * 0.92);
      ctx.stroke();
      break;
    }
    case 'boxNumber': {
      ctx.strokeRect(x + s * 0.18, y + s * 0.28, s * 0.64, s * 0.52);
      ctx.beginPath();
      ctx.moveTo(x + s * 0.18, y + s * 0.42);
      ctx.lineTo(x + s * 0.5, y + s * 0.18);
      ctx.lineTo(x + s * 0.82, y + s * 0.42);
      ctx.stroke();
      break;
    }
    case 'dimensions': {
      ctx.beginPath();
      ctx.moveTo(x + s * 0.18, y + s * 0.82);
      ctx.lineTo(x + s * 0.82, y + s * 0.18);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + s * 0.18, y + s * 0.82);
      ctx.lineTo(x + s * 0.18, y + s * 0.55);
      ctx.moveTo(x + s * 0.18, y + s * 0.82);
      ctx.lineTo(x + s * 0.45, y + s * 0.82);
      ctx.stroke();
      for (let i = 0; i < 4; i += 1) {
        const t = 0.25 + i * 0.14;
        ctx.beginPath();
        ctx.moveTo(x + s * (0.18 + t * 0.55), y + s * (0.82 - t * 0.55));
        ctx.lineTo(x + s * (0.18 + t * 0.55 - 0.06), y + s * (0.82 - t * 0.55 - 0.06));
        ctx.stroke();
      }
      break;
    }
    case 'contents': {
      ctx.strokeRect(x + s * 0.22, y + s * 0.22, s * 0.56, s * 0.64);
      ctx.strokeRect(x + s * 0.34, y + s * 0.12, s * 0.32, s * 0.18);
      ctx.beginPath();
      ctx.moveTo(x + s * 0.34, y + s * 0.48);
      ctx.lineTo(x + s * 0.66, y + s * 0.48);
      ctx.moveTo(x + s * 0.34, y + s * 0.62);
      ctx.lineTo(x + s * 0.66, y + s * 0.62);
      ctx.stroke();
      break;
    }
    case 'weight': {
      // kettlebell-ish
      ctx.beginPath();
      ctx.arc(x + s * 0.5, y + s * 0.58, s * 0.28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + s * 0.34, y + s * 0.36);
      ctx.quadraticCurveTo(x + s * 0.5, y + s * 0.12, x + s * 0.66, y + s * 0.36);
      ctx.stroke();
      ctx.font = `bold ${Math.round(s * 0.22)}px Arial, Helvetica, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('KG', x + s * 0.5, y + s * 0.6);
      break;
    }
    case 'transport': {
      ctx.strokeRect(x + s * 0.1, y + s * 0.38, s * 0.48, s * 0.28);
      ctx.beginPath();
      ctx.moveTo(x + s * 0.58, y + s * 0.48);
      ctx.lineTo(x + s * 0.78, y + s * 0.48);
      ctx.lineTo(x + s * 0.88, y + s * 0.6);
      ctx.lineTo(x + s * 0.88, y + s * 0.66);
      ctx.lineTo(x + s * 0.58, y + s * 0.66);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + s * 0.28, y + s * 0.74, s * 0.08, 0, Math.PI * 2);
      ctx.arc(x + s * 0.72, y + s * 0.74, s * 0.08, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'payment': {
      ctx.strokeRect(x + s * 0.12, y + s * 0.28, s * 0.76, s * 0.48);
      ctx.beginPath();
      ctx.moveTo(x + s * 0.12, y + s * 0.42);
      ctx.lineTo(x + s * 0.88, y + s * 0.42);
      ctx.stroke();
      ctx.fillRect(x + s * 0.22, y + s * 0.54, s * 0.22, s * 0.1);
      break;
    }
    case 'branch': {
      ctx.strokeRect(x + s * 0.22, y + s * 0.35, s * 0.56, s * 0.48);
      ctx.beginPath();
      ctx.moveTo(x + s * 0.14, y + s * 0.35);
      ctx.lineTo(x + s * 0.5, y + s * 0.12);
      ctx.lineTo(x + s * 0.86, y + s * 0.35);
      ctx.closePath();
      ctx.stroke();
      ctx.strokeRect(x + s * 0.42, y + s * 0.55, s * 0.16, s * 0.28);
      break;
    }
    case 'destination': {
      ctx.beginPath();
      ctx.arc(x + s * 0.5, y + s * 0.36, s * 0.22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + s * 0.5, y + s * 0.58);
      ctx.quadraticCurveTo(x + s * 0.5, y + s * 0.78, x + s * 0.5, y + s * 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + s * 0.5, y + s * 0.36, s * 0.08, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'time': {
      ctx.beginPath();
      ctx.arc(x + s * 0.5, y + s * 0.5, s * 0.34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + s * 0.5, y + s * 0.3);
      ctx.lineTo(x + s * 0.5, y + s * 0.5);
      ctx.lineTo(x + s * 0.68, y + s * 0.58);
      ctx.stroke();
      break;
    }
    case 'bookedBy': {
      ctx.beginPath();
      ctx.arc(x + s * 0.5, y + s * 0.34, s * 0.16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + s * 0.22, y + s * 0.82);
      ctx.quadraticCurveTo(x + s * 0.22, y + s * 0.58, x + s * 0.5, y + s * 0.58);
      ctx.quadraticCurveTo(x + s * 0.78, y + s * 0.58, x + s * 0.78, y + s * 0.82);
      ctx.stroke();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}
