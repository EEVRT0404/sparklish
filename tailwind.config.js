tailwind.config = {
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                theme: {
                    primary: 'var(--color-primary)',
                    accent: 'var(--color-accent)',
                    bg: 'var(--color-bg)',
                    card: 'var(--color-card)',
                    text: 'var(--color-text)',
                    border: 'var(--color-border)',
                }
            },
            animation: {
                'pulse-glow': 'pulseGlow 2s infinite',
                'float': 'float 3s ease-in-out infinite',
            },
            keyframes: {
                pulseGlow: {
                    '0%, 100%': { boxShadow: '0 0 15px rgba(var(--color-primary-rgb), 0.4)' },
                    '50%': { boxShadow: '0 0 30px rgba(var(--color-primary-rgb), 0.8)' },
                },
                float: {
                    '0%, 100%': { transform: 'translateY(0px)' },
                    '50%': { transform: 'translateY(-6px)' },
                }
            }
        }
    }
}
