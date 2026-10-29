'use client';
import AuthScene from '@/components/fx/AuthScene';
import SiteNav from '@/components/SiteNav';
import AuthSwitch from '@/components/ui/auth-switch';

export default function SignupPage() {
  return (
    <div className="auth-page">
      <AuthScene />
      <SiteNav current="signup" />
      <AuthSwitch initialMode="signup" />
    </div>
  );
}
