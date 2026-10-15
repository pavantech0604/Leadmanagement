import './globals.css';
import './branding.css';
import './operations.css';
export const metadata = { title: 'Capital Grow · Lead workspace', description: 'Grow your capital, grow your future. Your daily leads, connected across every branch.', icons: {icon:'/branding/capital-grow-emblem.png',apple:'/branding/capital-grow-emblem.png'} };
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>}
