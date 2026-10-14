import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import PremiumLoader from '../ui/PremiumLoader';
import {
    StudentsIcon,
    StaffIcon,
    ReportIcon,
    ReceiptIcon,
    HeartIcon,
    ChevronRightIcon,
    PlusIcon,
    MegaphoneIcon,
    LoginIcon,
    EditIcon,
    PublishIcon,
    DollarSignIcon,
    ClipboardListIcon,
    UsersIcon,
    BusVehicleIcon,
    TrashIcon,
    ArrowUpIcon,
    ArrowDownIcon,
    TrendingUpIcon,
    AttendanceSummaryIcon,
    ViewGridIcon,
    UserIcon,
    CheckCircleIcon,
    ClockIcon,
    SUBJECT_COLORS,
    XCircleIcon,
    DocumentTextIcon,
    HelpingHandIcon,
    ElearningIcon,
    SchoolLogoIcon,
    BookOpenIcon,
    SecurityIcon,
    FileTextIcon,
    AcademicCapIcon,
    UserGroupIcon,
    SearchIcon,
} from '../../constants';
// Mock data removed
import { AuditLog, RoleName } from '../../types';
import DonutChart from '../ui/DonutChart';
import { EmergencyBroadcastModal } from './EmergencyBroadcastModal';
import { AlertTriangle, Activity, Flame, ShieldCheck, Shield, FileText, Rocket, Beaker, Calendar, TrendingUp, Building2, Bus, BarChart3, Database, Monitor, Star, Receipt, Clock, FileCheck, Download, BellRing, LayoutGrid, GraduationCap, QrCode, ScanLine, Archive, UsersRound, ClipboardCheck, Repeat, ShieldAlert, ClipboardEdit, LogOut, DoorOpen, Gauge, School, Globe } from 'lucide-react';
import AIInsightsPanel from '../shared/AIInsightsPanel';
import { useNavigate } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import { useProfile } from '../../context/ProfileContext';
import { getDashboardCounts } from '../../src/lib/supabase/stats';
import { useApi } from '../../lib/hooks/useApi';
import { useAutoSync } from '../../hooks/useAutoSync';
import { getStatCardLayout, PREFERENCES_APPLIED_EVENT, type StatCardLayout } from '../../lib/uiPreferences';
import DashboardSkeletonLoader from '../ui/DashboardSkeletonLoader';


// --- NEW, REFINED UI/UX COMPONENTS ---

const StatCard: React.FC<{
    label: string;
    value: string | number;
    icon: React.ReactElement<{ className?: string }>;
    colorClasses: string;
    onClick: () => void;
    trend: string;
    trendColor: string;
    index?: number;
    layout?: StatCardLayout;
}> = ({ label, value, icon, colorClasses, onClick, trend, trendColor, index = 0, layout = 'compact' }) => {
    const { t } = useTranslation();
    // `formatTrend` yields "Stable" when nothing moved, "+n" for a rise and
    // "-n" for a fall. Anything that is not a rise used to draw a down arrow,
    // which made an unchanged figure look like a decline to a school owner.
    const isStable = !trend.startsWith('+') && !trend.startsWith('-');
    return (
    <motion.button
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: index * 0.06 }}
        whileHover={{ y: -3 }}
        whileTap={{ scale: 0.98 }}
        onClick={onClick}
        className={`w-full text-left ${layout === 'compact' ? 'p-3 sm:p-4' : 'p-4 sm:p-6'} rounded-3xl text-white relative overflow-hidden ${colorClasses}`}
    >
        {React.cloneElement(icon, { className: "absolute -right-6 -bottom-6 h-24 sm:h-32 w-24 sm:w-32 text-white/10" })}
        <div className="relative z-10">
            {/*
             * Four tiles share two thirds of the dashboard, so each one is
             * narrow even on a large screen. Measured at 1440px the label was
             * being handed a 55px box for an 82px word, and at 820px only 49px
             * — the text then painted straight over the icon. The label now
             * claims the leftover width rather than shrinking below it, long
             * words break instead of spilling, and the icon only grows to its
             * full size once the tile is genuinely wide enough to carry it.
             */}
            <div className="flex justify-between items-start gap-3">
                <p className={`text-white/90 font-bold flex-1 min-w-0 ${layout === 'compact' ? 'text-xs sm:text-sm' : 'text-base'}`}>{label}</p>
                <div className={`bg-white/20 rounded-2xl backdrop-blur-sm shrink-0 ${layout === 'compact' ? 'p-1.5 sm:p-2' : 'p-2'}`}>
                    {React.cloneElement(icon, { className: layout === 'compact' ? 'h-5 w-5 sm:h-6 sm:w-6' : 'h-6 w-6' })}
                </div>
            </div>
            <p className={`font-bold mt-2 sm:mt-3 tracking-tight truncate ${layout === 'compact' ? 'text-2xl sm:text-3xl' : 'text-3xl sm:text-4xl lg:text-5xl'}`}>{value}</p>
            {/*
             * The trend line reads as one sentence, so each part has to stay
             * whole. Left to itself the flex row squeezes the suffix until it
             * breaks mid-phrase — "last 30" on one line and "days" on the next,
             * with the arrow floating beside it. Each part is now nowrap and the
             * row wraps between them, so a narrow tile pushes the whole suffix
             * onto its own line instead of tearing the phrase in half.
             */}
            <div className={`mt-1 sm:mt-2 text-xs sm:text-sm font-bold flex flex-wrap items-center gap-x-1.5 gap-y-0.5 ${trendColor}`}>
                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    {/* A flat reading is not a decline, so it gets no arrow at all. */}
                    {isStable
                        ? null
                        : trend.startsWith('+')
                            ? <ArrowUpIcon className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
                            : <ArrowDownIcon className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />}
                    <span>{trend}</span>
                </span>
                {/* data-keep-whole: scripts/check-responsive-stages.mjs fails if this is ever split across lines. */}
                <span data-keep-whole className="text-white/70 font-medium whitespace-nowrap hidden xs:inline">{t('dashboard.last30Days')}</span>
            </div>
        </div>
    </motion.button>
    );
};


const QuickActionCard: React.FC<{ label: string; icon: React.ReactElement<{ className?: string }>; onClick: () => void; color: string; index?: number; }> = ({ label, icon, onClick, color, index = 0 }) => (
    <motion.button
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.3, delay: Math.min(index, 14) * 0.025 }}
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.95 }}
        onClick={onClick}
        className="bg-white p-3 sm:p-4 rounded-2xl shadow-sm flex flex-col items-center justify-center text-center hover:bg-gray-50 hover:shadow-md hover:ring-2 hover:ring-indigo-200 transition-shadow group h-full"
    >
        <div className={`p-3 sm:p-4 rounded-full ${color} group-hover:scale-110 transition-transform duration-200 flex-shrink-0`}>
            {React.cloneElement(icon, { className: "h-6 w-6 sm:h-8 sm:w-8 text-white" })}
        </div>
        <p className="font-bold text-gray-700 mt-2 sm:mt-3 text-xs sm:text-sm leading-tight line-clamp-2 md:line-clamp-none">{label}</p>
    </motion.button>
);

// Tailwind can't see runtime-interpolated classes (e.g. `color.replace('text-', 'bg-')`)
// and purges them from the production build, so alert cards need a fully-static
// per-color class map instead of string interpolation.
const ALERT_COLOR_CLASSES: Record<string, string> = {
    'text-indigo-600': 'bg-indigo-100',
    'text-red-500': 'bg-red-100',
    'text-orange-500': 'bg-orange-100',
};

const AlertCard: React.FC<{ label: string; value: string | number; icon: React.ReactElement<{ className?: string }>; onClick: () => void; color: string; index: number }> = ({ label, value, icon, onClick, color, index }) => {
    const { t } = useTranslation();
    return (
    <motion.button
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: index * 0.06 }}
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.98 }}
        onClick={onClick}
        className="w-full bg-white p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow flex items-center space-x-4 text-left border border-gray-100 hover:border-gray-200"
    >
        <div className={`${ALERT_COLOR_CLASSES[color] || 'bg-gray-100'} p-3 rounded-xl shrink-0`}>
            {React.cloneElement(icon, { className: `h-6 w-6 ${color}` })}
        </div>
        <div className="min-w-0">
            <p className="font-bold text-gray-800 text-lg">{value} {label}</p>
            <p className="text-xs text-gray-500 font-medium">{t('dashboardOverview.actionRequired')}</p>
        </div>
        <ChevronRightIcon className="h-6 w-6 text-gray-400 ml-auto" />
    </motion.button>
    );
};

const EnrollmentLineChart = ({ data, color }: { data: { year: number, count: number }[], color: string }) => {
    const width = 300; const height = 100; const padding = 20;
    const maxCount = data.length > 0 ? Math.ceil(Math.max(...data.map(d => d.count)) / 100) * 100 : 100;
    const minCount = data.length > 0 ? Math.floor(Math.min(...data.map(d => d.count)) / 100) * 100 : 0;
    const stepX = data.length > 1 ? (width - padding * 2) / (data.length - 1) : 0;
    const countRange = maxCount - minCount;
    const stepY = countRange > 0 ? (height - padding * 2) / countRange : 0;
    const points = data.map((d, i) => `${padding + i * stepX},${height - padding - (d.count - minCount) * stepY}`).join(' ');
    return (
        <div className="relative mt-2">
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
                <polyline fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={points} />
            </svg>
            <div className="flex justify-between px-4 -mt-6">
                {data.map((item, idx) => <span key={`${item.year}-${idx}`} className="text-xs text-gray-500 font-medium">{item.year}</span>)}
            </div>
        </div>
    );
};


const actionTypeIcons: { [key in AuditLog['type']]: React.ReactNode } = {
    login: <LoginIcon className="h-5 w-5 text-green-500" />,
    logout: <LoginIcon className="h-5 w-5 text-gray-500 transform scale-x-[-1]" />,
    create: <PlusIcon className="h-5 w-5 text-indigo-500" />,
    update: <EditIcon className="h-5 w-5 text-amber-500" />,
    delete: <TrashIcon className="h-5 w-5 text-red-500" />,
    publish: <PublishIcon className="h-5 w-5 text-purple-500" />,
    payment: <DollarSignIcon className="h-5 w-5 text-indigo-500" />,
};

const formatDistanceToNow = (isoDate: string): string => {
    const date = new Date(isoDate);
    const now = new Date();
    const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
};

const ActivityLogItem: React.FC<{ log: AuditLog, isLast: boolean, index?: number }> = ({ log, isLast, index = 0 }) => (
    <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2, delay: Math.min(index, 10) * 0.04 }}
        className="relative pl-12"
    >
        <div className="absolute left-4 top-2 w-0.5 h-full bg-gray-200"></div>
        <div className="absolute left-0 top-0 w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center bg-gray-100 ring-4 ring-gray-50">
            {actionTypeIcons[log.type]}
        </div>
        <div className="text-sm">
            <p className="text-gray-800">
                <span className="font-semibold">{log.user.name}</span> {log.action}
            </p>
            <p className="text-xs text-gray-400">{formatDistanceToNow(log.timestamp)}</p>
        </div>
    </motion.div>
);


// --- WIDGETS FOR LARGE SCREENS ---
const AddUserWidget = ({ onClick }: { onClick: () => void }) => {
    const { t } = useTranslation();
    return (
    <button onClick={onClick} className="bg-white p-4 rounded-xl shadow-sm text-left hover:bg-gray-50 transition-colors h-full flex flex-col">
        <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-100 rounded-lg"><PlusIcon className="h-5 w-5 text-indigo-600" /></div>
            <h4 className="font-bold text-gray-800">{t('dashboardOverview.addNewUser')}</h4>
        </div>
        <div className="flex-grow flex items-center justify-center space-x-4 mt-2">
            <div className="text-center"><div className="p-3 bg-gray-100 rounded-full"><StudentsIcon className="text-gray-500" /></div><p className="text-xs mt-1">{t('dashboardOverview.student')}</p></div>
            <div className="text-center"><div className="p-3 bg-gray-100 rounded-full"><StaffIcon className="text-gray-500" /></div><p className="text-xs mt-1">{t('dashboardOverview.teacher')}</p></div>
            <div className="text-center"><div className="p-3 bg-gray-100 rounded-full"><UsersIcon className="text-gray-500" /></div><p className="text-xs mt-1">{t('dashboardOverview.parent')}</p></div>
        </div>
    </button>
    );
};

const PublishReportsWidget = ({ onClick, count }: { onClick: () => void; count: number }) => {
    const { t } = useTranslation();
    return (
        <div className="bg-white p-4 rounded-xl shadow-sm flex flex-col h-full">
            <div className="flex items-center space-x-3">
                <div className="p-2 bg-purple-100 rounded-lg"><ReportIcon className="h-5 w-5 text-purple-600" /></div>
                <h4 className="font-bold text-gray-800">{t('dashboardOverview.publishReports')}</h4>
            </div>
            <div className="flex-grow flex flex-col items-center justify-center text-center">
                <p className="text-5xl font-bold text-purple-600">{count}</p>
                <p className="text-sm text-gray-600">{t('dashboardOverview.reportsArePendingReview')}</p>
            </div>
            <button onClick={onClick} className="w-full mt-2 py-2 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700">{t('dashboardOverview.viewReports')}</button>
        </div>
    );
};

const TimetableWidget = ({ onClick, schedule }: { onClick: () => void; schedule: any[] }) => {
    const { t } = useTranslation();
    return (
        <div className="bg-white p-4 rounded-xl shadow-sm flex flex-col h-full">
            <div className="flex items-center space-x-3">
                <div className="p-2 bg-indigo-100 rounded-lg"><ClipboardListIcon className="h-5 w-5 text-indigo-600" /></div>
                <h4 className="font-bold text-gray-800">{t('dashboardOverview.todayTimetable')}</h4>
            </div>
            <div className="flex-grow space-y-2 mt-3 text-sm">
                {schedule.length > 0 ? schedule.slice(0, 3).map((item, index) => (
                    <div key={index} className="flex items-center space-x-2">
                        <span className="font-semibold text-gray-500 w-16">{item.start_time}</span>
                        <span className={`px-2 py-1 rounded-md text-xs font-semibold ${SUBJECT_COLORS[item.subject] || 'bg-gray-100'}`}>
                            {item.subject} <span className="text-gray-400 font-normal">({item.class_name})</span>
                        </span>
                    </div>
                )) : <p className="text-gray-500 text-center pt-8">{t('dashboardOverview.noClassesScheduled')}</p>}
            </div>
            <button onClick={onClick} className="w-full mt-2 py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700">{t('dashboardOverview.manageTimetable')}</button>
        </div>
    );
};

const AnnounceWidget = ({ onClick }: { onClick: () => void }) => {
    const { t } = useTranslation();
    return (
    <button onClick={onClick} className="bg-white p-4 rounded-xl shadow-sm text-left hover:bg-gray-50 transition-colors h-full flex flex-col">
        <div className="flex items-center space-x-3">
            <div className="p-2 bg-teal-100 rounded-lg"><MegaphoneIcon className="h-5 w-5 text-teal-600" /></div>
            <h4 className="font-bold text-gray-800">{t('dashboardOverview.sendAnnouncement')}</h4>
        </div>
        <div className="flex-grow flex items-center justify-center">
            <div className="text-center">
                <MegaphoneIcon className="h-16 w-16 text-teal-200" />
                <p className="mt-2 text-sm text-gray-600">{t('dashboardOverview.reachEveryone')}</p>
            </div>
        </div>
    </button>
    );
};



// --- MAIN DASHBOARD COMPONENT ---

interface DashboardOverviewProps {
    navigateTo: (view: string, title: string, props?: any) => void;
    handleBack: () => void;
    forceUpdate: () => void;
    schoolId: string;
    currentBranchId: string | null;
}

const DashboardOverview: React.FC<DashboardOverviewProps> = ({ navigateTo, handleBack, forceUpdate, schoolId, currentBranchId }) => {
    const { t } = useTranslation();
    const { currentSchool, user } = useAuth();
    const { profile } = useProfile();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const activeSchoolId = schoolId || user?.school_id || profile?.schoolId || user?.user_metadata?.school_id;

    // DASHBOARD COUNTS COME FROM SUPABASE.
    //
    // This asked `api.getDashboardStats()`, which called the legacy Express
    // endpoint `/dashboard/stats`. That server is no longer deployed, so the query
    // never resolved and every tile fell back to its own default — the school had
    // 18 active teachers and the dashboard read "Total Staff 0".
    //
    // A wrong figure is worse than a visible error: nothing looks broken, so the
    // reader simply concludes the school is empty. The counts now come from the
    // database that actually holds the data.
    const {
        data: counts,
        isLoading: isLoadingStats,
        isError: statsFailed,
        refetch,
    } = useQuery({
        queryKey: ['dashboard-counts'],
        queryFn: getDashboardCounts,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });

    // THE BUS AND HEALTH WIDGETS ARE GONE. Both read from an undeployed server, and
    // NEITHER TABLE EXISTS in the database — no `buses`, no `health_logs`. The bus widget
    // showed a roster count that was always zero, and the health widget showed
    // `latestHealthLog = null` hard-coded, which reads as "no incidents ever recorded"
    // rather than "not connected". A widget that always shows zero is worse than no
    // widget: the office learns to ignore it.

    useAutoSync(
        [
            'students',
            'teachers',
            'parents',
            'classes',
            'student_fees',
            'report_cards',
            'health_logs',
            'student_attendance',
            'timetable'
        ],
        () => {
            console.log('🔄 [Dashboard] Auto-Sync triggered');
            refetch();
        }
    );

    const [isBroadcastOpen, setIsBroadcastOpen] = useState(false);
    const [actionSearch, setActionSearch] = useState('');

    // Derived stats for UI consumption.
    //
    // The counts are real. The trend figures and the few panels below them (health
    // log, timetable preview, unpublished reports) have no Supabase source yet, so
    // they stay at 0 — an honest "not built" rather than a stale number from a
    // server that no longer exists. Each is left explicit rather than deleted so
    // the remaining work is visible in one place.
    // WHEN THE FIGURES COULD NOT BE READ, THE TILES SAY SO.
    //
    // They used to fall back to 0, and that is the defect in audit finding F29: on
    // a register of ~250 people, "0" is not a missing figure, it is a claim that the
    // school is empty. Nobody investigates a zero, because a zero looks like an
    // answer.
    //
    // `show` renders an em dash where the number would be, so a tile reads "—"
    // rather than "0". The word "unreadable" would be clearer still, but these are
    // headline numbers on a card and this is the smallest change that stops the
    // screen from stating something false.
    const statsAvailable = !statsFailed && counts != null;

    // The NUMBERS stay numbers. Only the DISPLAY changes.
    //
    // The first version of this fix made `totalStudents` itself `'—'`, which broke
    // the enrolment chart: it builds a data point from the total and a chart needs
    // a number, so the page threw before it ever reached the alert. Numbers are
    // used for arithmetic all over this component; a display string has no business
    // in them.
    const totalStudents = counts?.students ?? 0;
    const totalStaff = counts?.staff ?? 0;
    const totalParents = counts?.guardians ?? 0;
    const totalClasses = counts?.classes ?? 0;
    const overdueFees = counts?.overdueCharges ?? 0;

    /** What a tile should PRINT. An em dash when the figure is not known. */
    const display = (value: number): number | string =>
        statsAvailable ? value : '—';

    // No data source yet — see the note above.
    const studentTrend = 0;
    const teacherTrend = 0;
    const parentTrend = 0;
    const classTrend = 0;
    const unpublishedReports = 0;
    const pendingApprovalsCount = 0;
    const attendancePercentage = 0;
    const timetablePreview: any[] = [];

    const recentActivities: any[] = [];

    // Bus Roster derived stats

    // No enrolment history source yet, so the chart shows the current roll as a
    // single point rather than an invented trend line between two guesses.
    const enrollmentData = [
        { year: new Date().getFullYear(), count: totalStudents },
    ];

    // The owner chooses how the total cards sit; the choice follows the account,
    // so it applies on a new device too. PREFERENCES_APPLIED_EVENT fires both when
    // this device changes it and when a newer account copy arrives at sign-in.
    const [statCardLayout, setStatCardLayout] = useState<StatCardLayout>(() => getStatCardLayout());
    useEffect(() => {
        const sync = () => setStatCardLayout(getStatCardLayout());
        window.addEventListener(PREFERENCES_APPLIED_EVENT, sync);
        return () => window.removeEventListener(PREFERENCES_APPLIED_EVENT, sync);
    }, []);

    // Measured during boot: this used to be a full-screen PremiumLoader that
    // mounted at t=3123ms — a second AFTER the dashboard was already interactive
    // at t=2572ms — and covered the whole app for ~1s. That was the second
    // "loading screen". Stats are only part of this page, so waiting for them
    // now shows the page's own skeleton in place, not a screen over everything.
    if (isLoadingStats && !counts) return <DashboardSkeletonLoader type="overview" />;


    const formatTrend = (val: number) => {
        if (val === 0) return 'Stable';
        return val > 0 ? `+${val}` : `${val}`;
    };

    // The "long tail" of Quick Actions beyond Daily Essentials — grouped by
    // category and rendered as a searchable, collapsible list instead of one
    // continuous wall of ~70 buttons. Every destination here is unchanged
    // from before; only the container around them changed.
    type QuickAction = { label: string; icon: React.ReactElement; onClick: () => void; color: string };
    type QuickActionCategory = { id: string; name: string; items: QuickAction[] };
    const quickActionCategories: QuickActionCategory[] = [
        {
            id: 'people', name: t('dashboardOverview.peopleAndEnrollment'), items: [
                { label: t('dashboardOverview.schoolStatus'), icon: <School className="w-6 h-6" />, onClick: () => navigateTo('digitalTwin', t('dashboardOverview.schoolStatus')), color: 'bg-slate-800' },
                { label: t('dashboardOverview.addUser'), icon: <PlusIcon />, onClick: () => navigateTo('selectUserTypeToAdd', t('dashboardOverview.addNewUser'), {}), color: 'bg-indigo-500' },
                { label: t('dashboardOverview.approvals'), icon: <CheckCircleIcon />, onClick: () => navigateTo('studentApprovals', t('dashboardOverview.studentApprovals')), color: 'bg-indigo-600' },
                { label: t('dashboardOverview.onboarding'), icon: <SchoolLogoIcon />, onClick: () => navigateTo('manageSchoolInfo', t('dashboardOverview.schoolOnboarding')), color: 'bg-pink-600' },
                { label: t('dashboardOverview.enrollStudent'), icon: <UserIcon />, onClick: () => navigateTo('enrollmentPage', t('dashboardOverview.newStudentEnrollment')), color: 'bg-emerald-600' },
                { label: t('dashboardOverview.pastStudents'), icon: <Archive className="w-6 h-6" />, onClick: () => navigateTo('pastStudents', t('dashboardOverview.pastStudents')), color: 'bg-slate-600' },
                { label: t('dashboardOverview.userAccounts'), icon: <UsersIcon />, onClick: () => navigateTo('userAccounts', t('dashboardOverview.userAccounts')), color: 'bg-indigo-600' },
                { label: t('dashboardOverview.curriculum'), icon: <Globe className="w-6 h-6" />, onClick: () => navigateTo('curriculumManagement', t('dashboardOverview.curriculumManagement')), color: 'bg-emerald-700' },
            ]
        },
        {
            id: 'academic', name: t('dashboardOverview.academic'), items: [
                { label: t('dashboardOverview.timetable'), icon: <ClipboardListIcon />, onClick: () => navigateTo('timetable', t('dashboardOverview.aiTimetable')), color: 'bg-indigo-500' },
                { label: t('dashboardOverview.teacherAssignments'), icon: <UsersRound className="w-6 h-6" />, onClick: () => navigateTo('teacherAssignments', t('dashboardOverview.teacherAssignments')), color: 'bg-purple-600' },
                { label: t('dashboardOverview.classroomsAndQr'), icon: <QrCode className="w-6 h-6" />, onClick: () => navigateTo('classroomManagement', t('dashboardOverview.classroomsAndQrCodes')), color: 'bg-sky-600' },
                { label: t('dashboardOverview.classVerification'), icon: <ScanLine className="w-6 h-6" />, onClick: () => navigateTo('classVerification', t('dashboardOverview.classVerification')), color: 'bg-blue-700' },
                { label: t('dashboardOverview.registerExams'), icon: <DocumentTextIcon />, onClick: () => navigateTo('exams', t('dashboardOverview.externalExams')), color: 'bg-indigo-600' },
                { label: t('dashboardOverview.enterResults'), icon: <TrendingUp />, onClick: () => navigateTo('resultsEntry', t('dashboardOverview.resultsEntry')), color: 'bg-cyan-600' },
                { label: t('dashboardOverview.publishReports'), icon: <ReportIcon />, onClick: () => navigateTo('reportCardPublishing', t('dashboardOverview.publishReports'), {}), color: 'bg-purple-500' },
                { label: t('dashboardOverview.promotion'), icon: <GraduationCap />, onClick: () => navigateTo('sessionPromotion', t('dashboardOverview.endOfSessionPromotion')), color: 'bg-indigo-700' },
                { label: t('dashboardOverview.trackAttendance'), icon: <Calendar />, onClick: () => navigateTo('attendanceTracker', t('dashboardOverview.curriculumAttendance')), color: 'bg-green-600' },
                { label: t('dashboardOverview.classroomObservation'), icon: <ClipboardEdit className="w-6 h-6" />, onClick: () => navigateTo('classroomObservation', t('dashboardOverview.classroomObservation')), color: 'bg-fuchsia-700' },
                { label: t('dashboardOverview.departments'), icon: <Building2 className="w-6 h-6" />, onClick: () => navigateTo('departmentManagement', t('dashboardOverview.departments')), color: 'bg-cyan-900' },
                { label: t('dashboardOverview.schoolClubs'), icon: <Star className="w-6 h-6" />, onClick: () => navigateTo('clubManagement', t('dashboardOverview.schoolClubs')), color: 'bg-amber-800' },
            ]
        },
        {
            id: 'attendanceSafety', name: t('dashboardOverview.attendanceAndSafety'), items: [
                { label: t('dashboardOverview.attendance'), icon: <ClockIcon />, onClick: () => navigateTo('teacherAttendance', t('dashboardOverview.teacherAttendance')), color: 'bg-amber-500' },
                { label: t('dashboardOverview.healthLog'), icon: <HeartIcon />, onClick: () => navigateTo('healthLog', t('dashboardOverview.healthLog')), color: 'bg-red-500' },
                { label: t('dashboardOverview.busRoster'), icon: <BusVehicleIcon />, onClick: () => navigateTo('busDutyRoster', t('dashboardOverview.busDutyRoster')), color: 'bg-orange-500' },
                { label: t('dashboardOverview.sopCases'), icon: <ClipboardCheck className="w-6 h-6" />, onClick: () => navigateTo('sopCaseManagement', t('dashboardOverview.caseManagement')), color: 'bg-rose-600' },
                { label: t('dashboardOverview.substituteCoverage'), icon: <Repeat className="w-6 h-6" />, onClick: () => navigateTo('substituteCoverage', t('dashboardOverview.substituteCoverage')), color: 'bg-teal-600' },
                { label: t('dashboardOverview.leaveApprovals'), icon: <ClipboardCheck className="w-6 h-6" />, onClick: () => navigateTo('leaveApproval', t('dashboardOverview.leaveApprovals')), color: 'bg-lime-700' },
                { label: t('dashboardOverview.atRiskStudents'), icon: <ShieldAlert className="w-6 h-6" />, onClick: () => navigateTo('atRiskStudents', t('dashboardOverview.atRiskStudents')), color: 'bg-red-700' },
                { label: t('dashboardOverview.studentGate'), icon: <LogOut className="w-6 h-6" />, onClick: () => navigateTo('studentGate', t('dashboardOverview.studentDeparture')), color: 'bg-cyan-700' },
                { label: t('dashboardOverview.gatePassApprovals'), icon: <DoorOpen className="w-6 h-6" />, onClick: () => navigateTo('gatePassApprovals', t('dashboardOverview.gatePassApprovals')), color: 'bg-cyan-800' },
                { label: t('dashboardOverview.emergency'), icon: <AlertTriangle />, onClick: () => setIsBroadcastOpen(true), color: 'bg-red-600 animate-pulse' },
            ]
        },
        {
            id: 'commsSystem', name: t('dashboardOverview.communicationAndSystem'), items: [
                { label: t('dashboardOverview.announce'), icon: <MegaphoneIcon />, onClick: () => navigateTo('communicationHub', t('dashboardOverview.communicationHub')), color: 'bg-teal-500' },
                { label: t('dashboardOverview.launchHub'), icon: <Rocket className="animate-bounce" />, onClick: () => navigateTo('onboardingPage', t('dashboardOverview.pilotOnboarding')), color: 'bg-gray-900' },
            ]
        },
        {
            id: 'contentManagement', name: t('dashboardOverview.contentManagement'), items: [
                { label: t('dashboardOverview.schoolPolicies'), icon: <DocumentTextIcon />, onClick: () => navigateTo('managePolicies', t('dashboardOverview.managePolicies')), color: 'bg-pink-500' },
                { label: t('dashboardOverview.volunteering'), icon: <HelpingHandIcon />, onClick: () => navigateTo('manageVolunteering', t('dashboardOverview.manageVolunteering')), color: 'bg-emerald-500' },
                { label: t('dashboardOverview.permissionSlips'), icon: <ClipboardListIcon />, onClick: () => navigateTo('managePermissionSlips', t('dashboardOverview.managePermissionSlips')), color: 'bg-cyan-500' },
                { label: t('dashboardOverview.learningResources'), icon: <ElearningIcon />, onClick: () => navigateTo('manageLearningResources', t('dashboardOverview.manageLearningResources')), color: 'bg-indigo-600' },
                { label: t('dashboardOverview.ptaMeetings'), icon: <AcademicCapIcon />, onClick: () => navigateTo('managePTAMeetings', t('dashboardOverview.ptaMeetings')), color: 'bg-indigo-600' },
                { label: t('dashboardOverview.externalExams'), icon: <Beaker />, onClick: () => navigateTo('exams', t('dashboardOverview.externalExams')), color: 'bg-indigo-600 shadow-lg shadow-indigo-100 ring-2 ring-indigo-50' },
                { label: t('dashboardOverview.enrollment'), icon: <UserGroupIcon />, onClick: () => navigateTo('enrollmentPage', t('dashboardOverview.studentEnrollment')), color: 'bg-indigo-600' },
                { label: t('dashboardOverview.curriculum'), icon: <BookOpenIcon />, onClick: () => navigateTo('manageCurriculum', t('dashboardOverview.curriculumConfiguration')), color: 'bg-indigo-600' },
                { label: t('dashboardOverview.lessonNotes'), icon: <BookOpenIcon />, onClick: () => navigateTo('lessonNotes', t('dashboardOverview.lessonNotesReview')), color: 'bg-violet-600' },
            ]
        },
        {
            id: 'infrastructure', name: t('dashboardOverview.infrastructureAndFacilities'), items: [
                { label: t('dashboardOverview.facilityRegister'), icon: <SchoolLogoIcon />, onClick: () => navigateTo('facilityRegister', t('dashboardOverview.facilityRegister')), color: 'bg-indigo-700' },
                { label: t('dashboardOverview.assetInventory'), icon: <ClipboardListIcon />, onClick: () => navigateTo('equipmentInventory', t('dashboardOverview.equipmentInventory')), color: 'bg-indigo-700' },
            ]
        },
        {
            id: 'boardingTransport', name: t('dashboardOverview.boardingAndTransport'), items: [
                { label: t('dashboardOverview.behaviorTracking'), icon: <Star />, onClick: () => navigateTo('behaviorLog', t('dashboardOverview.behaviorAndProgress')), color: 'bg-amber-600' },
            ]
        },
        {
            id: 'systemData', name: t('dashboardOverview.systemAndData'), items: [
                { label: t('dashboardOverview.customReports'), icon: <BarChart3 />, onClick: () => navigateTo('customReportBuilder', t('dashboardOverview.customReportBuilder')), color: 'bg-cyan-700' },
                { label: t('dashboardOverview.backupAndRestore'), icon: <Database />, onClick: () => navigateTo('backupRestore', t('dashboardOverview.dataBackupAndRestore')), color: 'bg-emerald-700' },
                { label: t('dashboardOverview.activeSessions'), icon: <Monitor />, onClick: () => navigateTo('sessionManagement', t('dashboardOverview.sessionManagement')), color: 'bg-slate-700' },
                { label: t('dashboardOverview.autoInvoices'), icon: <Receipt />, onClick: () => navigateTo('autoInvoice', t('dashboardOverview.autoInvoiceGenerator')), color: 'bg-teal-700' },
                { label: t('dashboardOverview.lateArrivals'), icon: <Clock />, onClick: () => navigateTo('lateArrivalConfig', t('dashboardOverview.lateArrivalConfig')), color: 'bg-rose-600' },
                { label: t('dashboardOverview.enrollmentTrends'), icon: <TrendingUp />, onClick: () => navigateTo('enrollmentTrends', t('dashboardOverview.enrollmentTrends')), color: 'bg-indigo-600' },
            ]
        },
        {
            id: 'compliancePrivacy', name: t('dashboardOverview.complianceAndPrivacy'), items: [
                { label: t('dashboardOverview.consentForms'), icon: <FileCheck />, onClick: () => navigateTo('consentForms', t('dashboardOverview.parentalConsentPdpa')), color: 'bg-green-700' },
                { label: t('dashboardOverview.dataExport'), icon: <Download />, onClick: () => navigateTo('dataExport', t('dashboardOverview.dataExportAndDeletion')), color: 'bg-gray-700' },
                { label: t('dashboardOverview.notificationSettings'), icon: <BellRing />, onClick: () => navigateTo('notificationDigest', t('dashboardOverview.notificationDigest')), color: 'bg-purple-600' },
                { label: t('dashboardOverview.projectBoards'), icon: <LayoutGrid />, onClick: () => navigateTo('projectBoard', t('dashboardOverview.kanbanProjectBoards')), color: 'bg-sky-600' },
            ]
        },
        {
            id: 'safetyWellbeing', name: t('dashboardOverview.safetyAndWellbeing'), items: [
                { label: t('dashboardOverview.emergencyAlerts'), icon: <AlertTriangle className="animate-pulse" />, onClick: () => navigateTo('emergencyAlert', t('dashboardOverview.emergencyAlerts')), color: 'bg-red-600' },
                { label: t('dashboardOverview.healthAndIncidents'), icon: <Activity />, onClick: () => navigateTo('safetyHealthLogs', t('dashboardOverview.safetyAndHealth')), color: 'bg-emerald-600' },
                { label: t('dashboardOverview.emergencyDrills'), icon: <Flame />, onClick: () => navigateTo('safetyHealthLogs', t('dashboardOverview.safetyAndHealth')), color: 'bg-orange-600' },
                { label: t('dashboardOverview.safeguarding'), icon: <ShieldCheck />, onClick: () => navigateTo('safetyHealthLogs', t('dashboardOverview.safetyAndHealth')), color: 'bg-indigo-600' },
            ]
        },
        {
            id: 'governanceMinistry', name: t('dashboardOverview.governanceAndMinistry'), items: [
                { label: t('dashboardOverview.qualityAssurance'), icon: <Shield className="animate-pulse" />, onClick: () => navigateTo('inspectionHub', t('dashboardOverview.inspectionHub')), color: 'bg-slate-800' },
                { label: t('dashboardOverview.ministryReports'), icon: <FileText />, onClick: () => navigateTo('inspectionHub', t('dashboardOverview.inspectionHub')), color: 'bg-slate-700' },
                { label: t('dashboardOverview.liveCompliance'), icon: <Activity className="text-emerald-400" />, onClick: () => navigateTo('complianceDashboard', t('dashboardOverview.complianceDashboard')), color: 'bg-slate-900 shadow-xl shadow-slate-200' },
                { label: t('dashboardOverview.governanceHub'), icon: <Shield className="text-yellow-400" />, onClick: () => navigateTo('governanceHub', t('dashboardOverview.unifiedGovernance')), color: 'bg-black shadow-xl' },
                { label: t('dashboardOverview.systemValidation'), icon: <Beaker />, onClick: () => navigateTo('validationConsole', t('dashboardOverview.validationConsole')), color: 'bg-indigo-900' },
            ]
        },
    ];

    return (
        <div className="p-4 lg:p-6 bg-gray-50 min-h-full">
            {/* A banner when the figures could not be read at all.
                This is the opposite of what used to be here. The dashboard once
                swallowed failures into 0 so that "one unreadable table cannot blank
                the page" — and the result was a page that reported the school had no
                staff. Blanking a tile is recoverable; stating a false number is not,
                because it is believed. */}
            {statsFailed && (
                <div
                    role="alert"
                    className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                >
                    {t('dashboard.countsUnavailable', {
                        defaultValue:
                            'Angka ringkasan tidak dapat dibaca buat masa ini, jadi ia dipaparkan sebagai —. Sila muat semula sebentar lagi.',
                    })}
                    <button
                        type="button"
                        onClick={() => refetch()}
                        className="ml-2 font-semibold underline"
                    >
                        {t('common.retry')}
                    </button>
                </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Content Column */}
                <div className="lg:col-span-2 space-y-6">
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="bg-gradient-to-br from-indigo-700 to-indigo-900 p-4 sm:p-6 rounded-3xl">
                        <h2 className="text-2xl font-bold text-white mb-1">
                            {t('dashboard.welcome', { name: (() => { const n = user?.full_name || profile?.full_name; if (!n) return 'Admin'; const first = n.split(' ')[0]; return ['school','admin','branch','main','demo'].includes(first.toLowerCase()) ? n : first; })() })}
                        </h2>
                        <p className="text-white/80">{t('dashboard.commandCenter')}</p>
                        <div className={`grid gap-3 sm:gap-4 mt-6 ${statCardLayout === 'compact' ? 'grid-cols-2 2xl:grid-cols-4' : 'grid-cols-1 xs:grid-cols-2'}`}>
                            <StatCard layout={statCardLayout} index={0} label={t('dashboard.totalStudents')} value={display(totalStudents)} icon={<StudentsIcon />} colorClasses="bg-gradient-to-br from-blue-500 to-blue-700" onClick={() => navigateTo('studentList', t('dashboardOverview.manageStudents'), {})} trend={formatTrend(studentTrend)} trendColor="text-blue-200" />
                            <StatCard layout={statCardLayout} index={1} label={t('dashboard.totalStaff')} value={display(totalStaff)} icon={<StaffIcon />} colorClasses="bg-gradient-to-br from-purple-400 to-purple-600" onClick={() => navigateTo('teacherList', t('dashboardOverview.manageTeachers'), {})} trend={formatTrend(teacherTrend)} trendColor="text-purple-200" />
                            <StatCard layout={statCardLayout} index={2} label={t('dashboard.totalParents')} value={display(totalParents)} icon={<UsersIcon />} colorClasses="bg-gradient-to-br from-orange-400 to-orange-600" onClick={() => navigateTo('parentList', t('dashboardOverview.manageGuardians'), {})} trend={formatTrend(parentTrend)} trendColor="text-orange-200" />
                            <StatCard layout={statCardLayout} index={3} label={t('dashboard.academicLevels')} value={display(totalClasses)} icon={<ViewGridIcon />} colorClasses="bg-gradient-to-br from-indigo-400 to-indigo-600" onClick={() => navigateTo('classList', t('dashboardOverview.manageClasses'), {})} trend={formatTrend(classTrend)} trendColor="text-indigo-200" />
                        </div>
                    </motion.div>

                    <div>
                        <h2 className="text-xl font-bold text-gray-700 mb-4 px-1">{t('dashboardOverview.quickActions')}</h2>

                        {/* Daily Essentials — the handful of actions an admin reaches for most days,
                            pulled to the top so the dashboard reads at a glance instead of requiring
                            a full scroll through 11 department sections to find them. Every destination
                            here also still appears in its normal department section below. */}
                        <div className="mb-6">
                            <h3 className="text-xs font-bold text-indigo-500 uppercase tracking-wider mb-2 px-1">{t('dashboardOverview.dailyEssentials')}</h3>
                            <div className="grid gap-2 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(5.5rem,1fr))]">
                                <QuickActionCard index={0} label={t('dashboardOverview.approvals')} icon={<CheckCircleIcon />} onClick={() => navigateTo('studentApprovals', t('dashboardOverview.studentApprovals'))} color="bg-indigo-600" />
                                <QuickActionCard index={1} label={t('dashboardOverview.attendance')} icon={<ClockIcon />} onClick={() => navigateTo('teacherAttendance', t('dashboardOverview.teacherAttendance'))} color="bg-amber-500" />
                                <QuickActionCard index={2} label={t('dashboardOverview.announce')} icon={<MegaphoneIcon />} onClick={() => navigateTo('communicationHub', t('dashboardOverview.communicationHub'))} color="bg-teal-500" />
                                {/* "Fee Management" removed: already a direct nav item on both desktop (sidebar) and mobile (bottom nav). */}
                                <QuickActionCard index={3} label={t('dashboardOverview.timetable')} icon={<ClipboardListIcon />} onClick={() => navigateTo('timetable', t('dashboardOverview.aiTimetable'))} color="bg-indigo-500" />
                                <QuickActionCard index={4} label={t('dashboardOverview.emergency')} icon={<AlertTriangle />} onClick={() => setIsBroadcastOpen(true)} color="bg-red-600 animate-pulse" />
                            </div>
                        </div>

                        {/* Everything else: the original always-expanded category sections,
                            with a search box above them that narrows the view down to
                            matching actions when typed into. */}
                        <div className="mt-2">
                            <div className="relative mb-4">
                                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                                <input
                                    type="text"
                                    value={actionSearch}
                                    onChange={(e) => setActionSearch(e.target.value)}
                                    placeholder={t('dashboardOverview.searchAllActions')}
                                    className="w-full pl-9 pr-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                />
                            </div>

                            {(() => {
                                const q = actionSearch.trim().toLowerCase();
                                const categoriesToShow = q
                                    ? quickActionCategories
                                        .map(cat => ({ ...cat, items: cat.items.filter(item => item.label.toLowerCase().includes(q)) }))
                                        .filter(cat => cat.items.length > 0)
                                    : quickActionCategories;
                                if (q && categoriesToShow.length === 0) {
                                    return <p className="text-sm text-gray-500 text-center py-6">No actions match "{actionSearch}".</p>;
                                }
                                return (
                                    <div className="space-y-6">
                                        {categoriesToShow.map(cat => (
                                            <div key={cat.id}>
                                                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">{cat.name}</h3>
                                                <div className="grid gap-2 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(5.5rem,1fr))]">
                                                    {cat.items.map((item, i) => (
                                                        <QuickActionCard key={item.label} index={i} label={item.label} icon={item.icon} onClick={item.onClick} color={item.color} />
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                );
                            })()}
                        </div>

                        {/* Desktop view */}
                        <div className="hidden lg:grid grid-cols-2 xl:grid-cols-3 gap-4 mt-8">
                            <AddUserWidget onClick={() => navigateTo('selectUserTypeToAdd', t('dashboardOverview.addNewUser'), {})} />
                            <PublishReportsWidget onClick={() => navigateTo('reportCardPublishing', t('dashboardOverview.publishReports'), {})} count={unpublishedReports} />
                            <TimetableWidget onClick={() => navigateTo('timetable', t('dashboardOverview.timetableManagement'))} schedule={timetablePreview} />
                            <AnnounceWidget onClick={() => navigateTo('communicationHub', t('dashboardOverview.communicationHub'))} />
                        </div>
                    </div>

                    <AIInsightsPanel />

                </div>

                {/* Sidebar Column */}
                <div className="lg:col-span-1 space-y-6 lg:sticky lg:top-6 lg:self-start">
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="bg-white p-4 rounded-2xl shadow-sm">
                        <h2 className="text-lg font-bold text-gray-700 mb-3 px-1">{t('dashboardOverview.schoolHealth')}</h2>
                        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                            <div>
                                <p className="font-semibold text-gray-800">{t('dashboardOverview.todayAttendance')}</p>
                                <p className="text-3xl font-bold text-indigo-600">{attendancePercentage > 0 ? `${attendancePercentage}%` : '--%'}</p>
                            </div>
                            <DonutChart percentage={attendancePercentage} color="#4f46e5" size={70} strokeWidth={8} />
                        </div>
                        <div className="mt-4">
                            <p className="font-semibold text-gray-800 px-1">{t('dashboardOverview.enrollmentTrend')}</p>
                            <EnrollmentLineChart data={enrollmentData} color="#4f46e5" />
                        </div>
                    </motion.div>

                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: 0.05 }}>
                        <h2 className="text-lg font-bold text-gray-700 mb-3 px-1">{t('dashboardOverview.actionRequired')}</h2>
                        <div className="space-y-3">
                            {pendingApprovalsCount > 0 && (
                                <AlertCard index={0} label={t('dashboardOverview.studentApprovals')} value={pendingApprovalsCount} icon={<CheckCircleIcon />} onClick={() => navigateTo('studentApprovals', t('dashboardOverview.studentApprovals'))} color="text-indigo-600" />
                            )}
                            {unpublishedReports > 0 && (
                                <AlertCard index={1} label={t('dashboardOverview.reportsToPublish')} value={unpublishedReports} icon={<ReportIcon />} onClick={() => navigateTo('reportCardPublishing', t('dashboardOverview.publishReports'))} color="text-red-500" />
                            )}
                            {overdueFees > 0 && (
                                <AlertCard index={2} label="in Overdue Fees" value={new Intl.NumberFormat('ms-MY', { style: 'currency', currency: 'MYR', maximumFractionDigits: 0 }).format(overdueFees)} icon={<ReceiptIcon />} onClick={() => navigateTo('feeManagement', t('dashboardOverview.feeManagement'))} color="text-orange-500" />
                            )}
                            {unpublishedReports === 0 && overdueFees === 0 && (
                                <div className="bg-white p-4 rounded-xl shadow-sm text-center text-gray-500">
                                    {t('dashboardOverview.noUrgentTasks')}
                                </div>
                            )}
                        </div>
                    </motion.div>

                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: 0.1 }}>
                        <h2 className="text-lg font-bold text-gray-700 mb-3 px-1">{t('dashboardOverview.recentActivity')}</h2>
                        <div className="bg-white p-4 rounded-2xl shadow-sm space-y-4">
                            {recentActivities.map((log, index) => <ActivityLogItem key={log.id} log={log} isLast={index === recentActivities.length - 1} index={index} />)}
                            <motion.button whileTap={{ scale: 0.97 }} onClick={() => navigateTo('auditLog', t('dashboardOverview.auditLog'))} className="mt-2 text-sm w-full text-center font-semibold text-indigo-600 hover:text-indigo-800 py-2.5 rounded-lg hover:bg-indigo-50 transition-colors">
                                {t('dashboardOverview.viewFullLog')}
                            </motion.button>
                        </div>
                    </motion.div>
                </div>
            </div >

            {isBroadcastOpen && (
                <EmergencyBroadcastModal
                    isOpen={isBroadcastOpen}
                    onClose={() => setIsBroadcastOpen(false)}
                    schoolId={activeSchoolId}
                />
            )}
        </div >
    );
};

export default DashboardOverview;
