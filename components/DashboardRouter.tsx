import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { DashboardType } from '../types';
import { Routes, Route } from 'react-router';
import VerifiedAdminRoute from './auth/VerifiedAdminRoute';
import { lazyWithRetry } from '../lib/lazyRetry';
import { prefetchRoleChunks } from '../lib/rolePrefetch';
import PremiumLoader, { BOOT_MESSAGE } from './ui/PremiumLoader';

const PremiumErrorPage = lazyWithRetry(() => import('./ui/PremiumErrorPage'));

/**
 * Shown at /subscription and /upgrade.
 *
 * There is no plan to buy and no renewal to make: the school runs its own system
 * and bills its own families in Ringgit at the office. The reader gets a plain
 * sentence rather than a payment page for a company that has nothing to do with
 * their school.
 */
const NotApplicablePage: React.FC = () => {
    const { t } = useTranslation();
    return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-16 text-center">
        <h2 className="text-xl font-bold text-gray-900 mb-2">{t('dashboardRouter.tiadaApaApaUntukDibayarDiSini')}</h2>
        <p className="text-sm text-gray-500 max-w-md leading-relaxed">
            Sistem ini dimiliki dan diuruskan oleh sekolah. Yuran murid dijelaskan di pejabat
            sekolah, bukan melalui halaman ini.
        </p>
    </div>
    );
};

const AdminDashboard = lazyWithRetry(() => import('./admin/AdminDashboard'));
const TeacherDashboard = lazyWithRetry(() => import('./teacher/TeacherDashboard'));
const StudentDashboard = lazyWithRetry(() => import('./student/StudentDashboard'));
const ParentDashboard = lazyWithRetry(() => import('./parent/ParentDashboard'));
const ExternalExamsPage = lazyWithRetry(() => import('./admin/ExternalExamsPage'));

/**
 * The router shows the same school loader as the rest of the app.
 *
 * It used to render a bare indigo spinner on grey. Starting the app crosses this
 * router between two phases that both show the branded loader, so the sequence
 * read as branded screen, then a completely different spinner, then branded
 * again — the "two loading screens" people were seeing. Same component now, so
 * there is nothing to cut between.
 */
const LoadingScreen = () => <PremiumLoader message={BOOT_MESSAGE} />;

interface DashboardRouterProps {
    onLogout?: () => void;
    setIsHomePage?: (value: boolean) => void;
    currentUser?: any;
    [key: string]: any;
}

const DashboardRouter: React.FC<DashboardRouterProps> = (props) => {
    const { t } = useTranslation();
    const { role, currentSchool, loading } = useAuth();

    useEffect(() => {
        if (currentSchool?.primaryColor) {
            document.documentElement.style.setProperty('--primary-color', currentSchool.primaryColor);
        }
    }, [currentSchool]);

    // Deliberately no navigate('/login') here. There is no real /login route —
    // Login is rendered inline by App.tsx's own `if (!user || !role)` check,
    // at whatever URL the browser already has. Forcing a URL change to
    // '/login' here (which nothing in the route tree matches) would strand a
    // session-expiry mid-dashboard at a dead '/login' URL instead of letting
    // the user land back on the exact screen they were on once they sign back
    // in — the same URL just needs to stay put and let App.tsx's conditional
    // do its job on the next render.

    // The current dashboard is already interactive by the time this router has
    // resolved the role. Warm only a small, role-safe set of likely next screens.
    // This runs during idle time and never blocks the current render.
    useEffect(() => {
        if (loading || !role) return;
        const start = () => prefetchRoleChunks(String(role));
        // typeof, not `in`: lib.dom declares requestIdleCallback as always present,
        // so `"requestIdleCallback" in window` narrows window to never in the else
        // branch and window.setTimeout stops type-checking there.
        const idle = typeof window.requestIdleCallback === "function"
            ? window.requestIdleCallback(start, { timeout: 2000 })
            : window.setTimeout(start, 500);
        return () => {
            if ('cancelIdleCallback' in window && typeof idle === 'number') window.cancelIdleCallback(idle);
            else window.clearTimeout(idle as number);
        };
    }, [loading, role]);

    // Only before we know the role. After that the dashboard is rendered, and a
    // background auth refresh must not swap it out for a full-screen loader.
    if (loading && !role) return <LoadingScreen />;

    const renderDashboard = () => {
        switch (role) {
            case DashboardType.Admin:
                return <VerifiedAdminRoute><AdminDashboard {...props} /></VerifiedAdminRoute>;
            case DashboardType.Teacher:
                return <TeacherDashboard {...props} />;
            case DashboardType.Student:
                return <StudentDashboard {...props} />;
            case DashboardType.Parent:
            case DashboardType.Guardian:
                return <ParentDashboard {...props} />;
            default:
                return (
                    <PremiumErrorPage
                        title={t('dashboardRouter.accessDenied')}
                        message="Your current role is not recognized or you don't have permission to access this area."
                        resetErrorBoundary={() => props.onLogout ? props.onLogout() : (window.location.href = '/login')}
                    />
                );
        }
    };

    return (
        <React.Suspense fallback={<LoadingScreen />}>
            <div
                className="dashboard-container h-full w-full"
                style={{
                    '--school-primary': currentSchool?.primaryColor || '#4F46E5',
                    '--school-secondary': currentSchool?.secondaryColor || '#ffffff',
                } as React.CSSProperties}
            >
                <Routes>
                    {/* Nothing to pay. These paths were the vendor's plan/renewal
                        pages, which charged the school for access to the app it
                        runs. They are real addresses people may have bookmarked,
                        so they answer honestly instead of 404-ing or showing a
                        blank dashboard. */}
                    <Route path="/subscription" element={<NotApplicablePage />} />
                    <Route path="/upgrade" element={<NotApplicablePage />} />
                    <Route path="/external-exams" element={<ExternalExamsPage {...(props as any)} />} />
                    {/* Every other path (including bare "/") renders the same
                        role dashboard shell — each dashboard now reads its own
                        screen name from the wildcard via useDashboardRouting,
                        so this one route covers every screen instead of only
                        the dashboard's default view. */}
                    <Route path="/*" element={renderDashboard()} />
                </Routes>
            </div>
        </React.Suspense>
    );
};

export default DashboardRouter;
