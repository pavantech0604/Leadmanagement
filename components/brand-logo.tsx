import Image from 'next/image';

/** Original supplied artwork, preserved with its transparent background. */
export function BrandLogo({full=false,className=''}:{full?:boolean;className?:string}) {
  return <span className={`capital-logo ${full?'capital-logo-full':'capital-logo-emblem'} ${className}`}>
    <Image src={`/branding/capital-grow-${full?'logo':'emblem'}.png`} alt={full?'Capital Grow — Grow your capital, grow your future':'Capital Grow bull and growth arrow emblem'} width={full?2292:1484} height={full?1740:1268} sizes={full?'(max-width: 550px) 160px, 220px':'(max-width: 850px) 42px, 48px'} priority />
  </span>;
}
