'use client';
import AuthScene from '@/components/fx/AuthScene';
import SiteNav from '@/components/SiteNav';
import AuthSwitch from '@/components/ui/auth-switch';

export default function LoginPage() {
  return (
    <div className="auth-page">
      <AuthScene />
      <SiteNav current="login" />
      <AuthSwitch initialMode="signin" />
    </div>
  );
}
