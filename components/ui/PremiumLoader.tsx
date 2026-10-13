import React, { useState } from 'react';
import { SCHOOL_LOGO_SRC, SCHOOL_NAME, SCHOOL_MONOGRAM } from '../../src/lib/branding';
import i18n from '../../lib/i18n';

/**
 * The one loading screen in the app.
 *
 * It shows the school's logo — spinning gently on a vertical axis, like a coin
 * turning over, while it pulses. The motion is deliberately slow and calm: this
 * appears on a slow connection at the start of the day, and something that
 * spins fast reads as a warning rather than as patience.
 *
 * WHY THE SPIN IS A ROTATION AROUND Y. A flat `rotate` on a round logo would be
 * invisible, because a circle looks the same at every angle. Turning it around
 * the vertical axis is what makes the movement legible, and it is what makes the
 * logo read as a coin settling rather than as a picture twitching.
 *
 * WHY THE ANIMATION STOPS FOR SOMEONE WHO ASKED IT TO. A continuously turning
 * element is exactly what `prefers-reduced-motion` exists for. When the device
 * asks for less motion the logo simply sits still, because a loading screen that
 * makes someone unwell is worse than one that does not move.
 *
 * The caption is the school's name, not a vendor's. This was the last place in
 * the app that still said "Oliskey School App", which is a company that has
 * nothing to do with this school.
 *
 * BOOT_MESSAGE is the single caption every start-up gate uses. Each gate mounts
 * its own loader, so a caption that changes halfway is the one remaining thing
 * that makes a continuous wait read as two separate loading screens.
 */
export const BOOT_MESSAGE = i18n.t('premiumLoader.bootMessage');

const PremiumLoader: React.FC<{ message?: string; fullScreen?: boolean }> = ({ message = BOOT_MESSAGE, fullScreen = true }) => {
    // If the crest file has not been supplied yet, fall back to the school's
    // monogram rather than showing a broken image on a phone.
    const [logoMissing, setLogoMissing] = useState(false);

    return (
        <div className={`flex flex-col items-center justify-center bg-white ${fullScreen ? 'fixed inset-0 z-[10000]' : 'w-full h-full flex-1 min-h-[60vh] z-50 rounded-2xl my-auto'}`}>
            {/* The logo, turning like a coin. See the keyframes below. */}
            <div className="srik-coin w-28 h-28 flex items-center justify-center">
                {logoMissing ? (
                    <div className="w-24 h-24 rounded-3xl bg-teal-700 text-white font-extrabold
                                    text-2xl tracking-wide flex items-center justify-center">
                        {SCHOOL_MONOGRAM}
                    </div>
                ) : (
                    <img
                        src={SCHOOL_LOGO_SRC}
                        alt=""
                        /* Decorative: the school's name is already written below,
                           so announcing the image again would read it out twice. */
                        aria-hidden="true"
                        draggable={false}
                        onError={() => setLogoMissing(true)}
                        className="w-full h-full object-contain select-none"
                    />
                )}
            </div>

            <div className="mt-8 text-center">
                <h3 className="text-xl font-bold text-slate-800">{SCHOOL_NAME}</h3>
                <p className="mt-2 text-slate-500 font-medium tracking-wide flex items-center justify-center gap-2">
                    <span className="srik-dot inline-block w-1.5 h-1.5 bg-teal-600 rounded-full"></span>
                    {message}
                    <span className="srik-dot srik-dot-late inline-block w-1.5 h-1.5 bg-teal-600 rounded-full"></span>
                </p>
            </div>

            {/*
              * Scoped to `srik-` names, and that matters. This file once
              * redefined Tailwind's own `@keyframes ping`, so mounting the loader
              * silently changed every `animate-ping` in the app while it was on
              * screen. Nothing here can affect another component.
              */}
            <style>{`
                /* A coin turning over: rotation around the vertical axis, so the
                   logo narrows to a sliver and opens again. Plus a slow breath
                   in size, so the wait feels alive rather than frozen. */
                @keyframes srikCoinTurn {
                    0%   { transform: perspective(600px) rotateY(0deg) scale(1); }
                    50%  { transform: perspective(600px) rotateY(180deg) scale(1.06); }
                    100% { transform: perspective(600px) rotateY(360deg) scale(1); }
                }
                @keyframes srikBreathe {
                    0%, 100% { opacity: 1; }
                    50%      { opacity: 0.72; }
                }
                .srik-coin {
                    animation: srikCoinTurn 5.5s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite;
                    /* The back of the coin is the logo mirrored; keeping it
                       facing forward avoids reading as a backwards crest. */
                    backface-visibility: visible;
                    transform-style: preserve-3d;
                }
                .srik-dot {
                    animation: srikBreathe 1.6s ease-in-out infinite;
                }
                .srik-dot-late { animation-delay: 0.2s; }

                /* Honour a device that asked for less motion. The logo then sits
                   still, which is a perfectly good loading screen. */
                @media (prefers-reduced-motion: reduce) {
                    .srik-coin, .srik-dot { animation: none; }
                }
            `}</style>
        </div>
    );
};

export default PremiumLoader;
