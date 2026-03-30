"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Brain } from "lucide-react";
import "./page.module.css";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || isLoading) return;

    setError("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        const nextParam = searchParams.get("next");
        const target = nextParam && nextParam.startsWith("/") ? nextParam : "/";
        router.push(target);
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || "Invalid credentials");
        setIsLoading(false);
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container" style={{
      display: 'flex',
      minHeight: '100vh',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      padding: '20px'
    }}>
      <div className="login-card" style={{
        width: '100%',
        maxWidth: '360px',
        background: 'var(--bg-secondary)',
        padding: '40px',
        borderRadius: '12px',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-lg)',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: '2.5rem',
            marginBottom: '16px',
            display: 'inline-block'
          }}>
            <Brain size={48} strokeWidth={1.5} />
          </div>
          <h1 className="login-title" style={{
            fontSize: '1.5rem',
            fontWeight: 600,
            margin: 0,
            color: 'var(--text-primary)'
          }}>Welcome Back</h1>
          <p style={{
            fontSize: '0.875rem',
            color: 'var(--text-muted)',
            marginTop: '8px'
          }}>Sign in to your OkBrain account</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              autoFocus
              style={{
                width: '100%',
                padding: '12px 16px',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                color: 'var(--text-primary)',
                fontSize: '1rem',
                outline: 'none',
                transition: 'border-color 0.2s',
                boxShadow: 'none',
                WebkitAppearance: 'none'
              }}
              className="login-input-field"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              style={{
                width: '100%',
                padding: '12px 16px',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                color: 'var(--text-primary)',
                fontSize: '1rem',
                outline: 'none',
                transition: 'border-color 0.2s',
                boxShadow: 'none',
                WebkitAppearance: 'none'
              }}
              className="login-input-field"
            />
            <style jsx>{`
              .login-input-field:focus {
                border-color: var(--text-primary) !important;
              }
            `}</style>
          </div>

          {error && (
            <div style={{
              color: '#ff6b6b',
              fontSize: '0.8125rem',
              textAlign: 'center',
              padding: '10px',
              background: 'rgba(255, 107, 107, 0.1)',
              borderRadius: '6px',
              border: '1px solid rgba(255, 107, 107, 0.2)'
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !email || !password}
            style={{
              width: '100%',
              padding: '12px',
              background: 'var(--text-primary)',
              color: 'var(--bg-secondary)',
              border: 'none',
              borderRadius: '8px',
              fontSize: '0.9375rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'opacity 0.2s',
              opacity: isLoading || !email || !password ? 0.5 : 1
            }}
          >
            {isLoading ? "Signing in..." : "Login"}
          </button>
        </form>

        <div style={{
          textAlign: 'center',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          marginTop: '8px'
        }}>
          &copy; {new Date().getFullYear()} OkBrain AI
        </div>
      </div>
    </div>
  );
}
