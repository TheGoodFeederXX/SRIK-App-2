import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { useAutoSync } from '../../hooks/useAutoSync';
import { useAuth } from '../../context/AuthContext';
import { listMyChildren } from '../../src/lib/supabase/family';
import { getClassRegister } from '../../src/lib/supabase/attendance';
import { listAnnouncements } from '../../src/lib/supabase/announcements';
import {
    CircleCheck,
    Calendar,
    Bell,
    ChevronRight,
    FileText,
    Utensils
} from 'lucide-react';

interface ChildSummary {
    id: string;
    name: string;
    class_name: string;
    /** null means the register for today has NOT been taken — not that they were away. */
    attendance_status: 'present' | 'absent' | 'late' | 'leave' | 'not_marked';
    classId: string | null;
}

interface FeedItem {
    id: string;
    type: 'attendance' | 'event';
    child_name: string;
    description: string;
    time: string;
    icon_color: string;
}

/**
 * Today, for a parent.
 *
 * WHAT THIS USED TO SHOW. Homework pending, fees due, bus status, behaviour points and
 * upcoming events — for a school with no assignments table, no bus routes, no behaviour
 * notes and no events table. Every one of those came from a server that is not deployed,
 * so the cards were blank or zero and the activity feed was permanently empty.
 *
 * WHAT IT SHOWS NOW. Today's register for each child, and the school's own notices. A
 * register that has not been taken today says so, rather than showing "absent" — the
 * difference matters to a parent standing at the gate.
 */

const ParentTodayWidget = ({ navigateTo }: { navigateTo: (view: string, title: string, props?: any) => void }) => {
    const { t } = useTranslation();
    const { user } = useAuth();
    const [selectedChild, setSelectedChild] = useState(0);
    // True once a load has completed, so background refreshes never flash a skeleton.
    const hasLoadedOnceRef = useRef(false);

    const [children, setChildren] = useState<ChildSummary[]>([]);
    const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchTodayUpdate = useCallback(async () => {
        try {
        // Only show the skeleton on the FIRST load. A realtime refresh must not
        // replace content the user is reading with a spinner and replay the entry
        // animations — that is what made these screens blink.
            if (!hasLoadedOnceRef.current) setLoading(true);

            // The children come from the session, not from a parent id.
            const mine = await listMyChildren();
            const today = new Date().toISOString().slice(0, 10);

            const summaries: ChildSummary[] = [];
            const feed: FeedItem[] = [];

            for (const c of mine) {
                const s = c.student;
                const row = { id: s.id, name: s.fullName, class_name: s.className || '', classId: s.classId };

                // Today's register, if the class has one. A missing row is "not marked",
                // which is a different thing from "absent" and is shown as such.
                let status: ChildSummary['attendance_status'] = 'not_marked';
                if (s.classId) {
                    try {
                        const register = await getClassRegister(s.classId, today);
                        const entry = register.find(r => r.studentId === s.id);
                        if (entry?.status === 'PRESENT') status = 'present';
                        else if (entry?.status === 'ABSENT') status = 'absent';
                        else if (entry?.status === 'LATE') status = 'late';
                        else if (entry?.status === 'EXCUSED' || entry?.status === 'SICK') status = 'leave';
                    } catch {
                        // A register that cannot be read leaves the day unmarked rather
                        // than claiming anything about the child.
                    }
                }

                summaries.push({ ...row, attendance_status: status });
                feed.push({
                    id: `${s.id}-today`,
                    type: 'attendance',
                    child_name: s.fullName,
                    description: status === 'not_marked'
                        ? 'Attendance has not been taken yet today.'
                        : `Marked ${status} today.`,
                    time: today,
                    icon_color: 'text-emerald-600',
                });
            }

            // The school's own published notices, which a guardian can genuinely read.
            const notices = (await listAnnouncements())
                .filter(a => a.status === 'PUBLISHED')
                .slice(0, 5);
            for (const n of notices) {
                feed.push({
                    id: `notice-${n.id}`,
                    type: 'event',
                    child_name: 'School',
                    description: n.title,
                    time: n.publish_at ?? n.created_at,
                    icon_color: 'text-indigo-600',
                });
            }

            setChildren(summaries);
            setFeedItems(feed);
        } catch (err: any) {
            console.error('Failed to fetch today update:', err);
            setError(err.message);
            // Fallback to empty states if API fails
            setChildren([]);
            setFeedItems([]);
        } finally {
            hasLoadedOnceRef.current = true; setLoading(false);
        }
    }, []);

    // Real-time synchronization
    // Only tables that exist.
    useAutoSync(['students', 'student_attendance', 'announcements'], fetchTodayUpdate);

    useEffect(() => {
        fetchTodayUpdate();
    }, [fetchTodayUpdate]);

    if (loading) {
        return <div className="p-8 text-center bg-white rounded-xl shadow-sm border border-slate-100">
            <div className="animate-pulse flex flex-col items-center">
                <div className="w-12 h-12 bg-slate-200 rounded-full mb-4"></div>
                <div className="h-4 bg-slate-200 rounded w-48 mb-2"></div>
                <div className="h-4 bg-slate-200 rounded w-32"></div>
            </div>
        </div>;
    }

    if (error) {
        return <div className="p-8 text-center text-red-600 bg-red-50 rounded-xl shadow-sm border border-red-100">
            <p>Error loading data: {error}</p>
            <p>{t('parentTodayWidget.pleaseTryAgainLater')}</p>
        </div>;
    }

    // If no children data, display a message
    if (children.length === 0) {
        return <div className="p-8 text-center bg-white rounded-xl shadow-sm border border-slate-100">
            <p className="text-gray-600">{t('parentTodayWidget.noChildrenDataAvailablePleaseContactSupportIfT')}</p>
        </div>;
    }

    const child = children[selectedChild];
    // ⏳ for a register not yet taken, which is NOT the same as absent.
    const attendanceIcon = child.attendance_status === 'present' ? '✅'
        : child.attendance_status === 'late' ? '⏰'
        : child.attendance_status === 'absent' ? '❌'
        : child.attendance_status === 'leave' ? '🏠'
        : '⏳';
    const greetingHour = new Date().getHours();
    const greeting = greetingHour < 12 ? 'Good Morning' : greetingHour < 17 ? 'Good Afternoon' : 'Good Evening';

    // Only the two kinds of entry this screen can actually produce: a register mark and
    // a school notice. The old map had homework, fees, behaviour and messages — none of
    // which has a table, so none of which could ever appear.
    const getFeedIcon = (type: string) => {
        switch (type) {
            case 'attendance': return CircleCheck;
            case 'event': return Calendar;
            default: return Bell;
        }
    };

    return (
        <div className="w-full p-6 max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="bg-gradient-to-br from-indigo-600 to-indigo-800 p-6 rounded-3xl text-white"
            >
                <h1 className="text-2xl font-bold font-outfit">{greeting}, Parent! 👋</h1>
                <p className="text-white/70 mt-1">{t('parentTodayWidget.hereSEverythingHappeningToday')}</p>
                {/* Child Selector */}
                {children.length > 1 && (
                    <div className="flex flex-wrap gap-3 mt-4">
                        {children.map((c, i) => (
                            <motion.button key={c.id} whileTap={{ scale: 0.95 }} onClick={() => setSelectedChild(i)}
                                className={`min-h-11 px-4 py-2 rounded-2xl font-bold text-sm transition-all ${selectedChild === i ? 'bg-white text-indigo-700 shadow-lg' : 'bg-white/20 text-white/90 hover:bg-white/30'}`}>
                                {c.name.split(' ')[0]} • {c.class_name}
                            </motion.button>
                        ))}
                    </div>
                )}
            </motion.div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 min-[360px]:grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    // ONE card, because there is one thing this school can honestly say
                    // about today. Homework, bus status and behaviour were all removed:
                    // no table backs any of them, so each was a permanently blank or zero
                    // card that told a parent nothing while looking like information.
                    {
                        onClick: () => navigateTo('attendanceOverview', 'Attendance'),
                        iconBg: 'bg-emerald-50',
                        icon: <CircleCheck className="w-5 h-5 text-emerald-600" />,
                        corner: <span className="text-2xl">{attendanceIcon}</span>,
                        value: <span className="capitalize">
                            {child.attendance_status === 'not_marked'
                                ? 'Not taken yet'
                                : child.attendance_status.replace('_', ' ')}
                        </span>,
                        label: t('parentTodayWidget.attendanceToday'),
                    },
                ].map((card, i) => (
                    <motion.button
                        key={card.label}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25, delay: i * 0.06 }}
                        whileHover={{ y: -3 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={card.onClick}
                        className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 text-left hover:shadow-md transition-shadow"
                    >
                        <div className="flex justify-between items-start">
                            <div className={`p-2 rounded-2xl ${card.iconBg}`}>{card.icon}</div>
                            {card.corner}
                        </div>
                        <p className="font-bold text-gray-800 mt-3">{card.value}</p>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">{card.label}</p>
                    </motion.button>
                ))}
            </div>

            {/* Quick Actions — only destinations that are real. "Pay Fees" and
                "Message Teacher" led to screens for features this school does not run. */}
            <div className="flex space-x-3 overflow-x-auto pb-2">
                <motion.button whileTap={{ scale: 0.96 }} onClick={() => navigateTo('reportCard', 'Report Card')} className="flex items-center space-x-2 bg-white text-gray-700 min-h-11 px-5 py-2.5 rounded-2xl font-bold text-sm border border-gray-100 whitespace-nowrap hover:bg-gray-50 transition-colors">
                    <FileText className="w-4 h-4" /><span>{t('parentTodayWidget.viewReportCard')}</span>
                </motion.button>
                <motion.button whileTap={{ scale: 0.96 }} onClick={() => navigateTo('schoolCalendar', 'Calendar')} className="flex items-center space-x-2 bg-white text-gray-700 min-h-11 px-5 py-2.5 rounded-2xl font-bold text-sm border border-gray-100 whitespace-nowrap hover:bg-gray-50 transition-colors">
                    <Calendar className="w-4 h-4" /><span>{t('parentTodayWidget.schoolCalendar')}</span>
                </motion.button>
            </div>

            {/* Activity Feed */}
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6">
                <h2 className="text-lg font-bold text-gray-800 mb-4">{t('parentTodayWidget.todaySActivityFeed')}</h2>
                <div className="space-y-4">
                    {feedItems.map((item, i) => {
                        const Icon = getFeedIcon(item.type);
                        return (
                            <motion.div
                                key={item.id}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.2, delay: Math.min(i, 10) * 0.04 }}
                                whileHover={{ x: 2 }}
                                className="flex items-start space-x-4 py-3 border-b border-gray-50 last:border-b-0"
                            >
                                <div className={`p-2 rounded-xl bg-gray-50 ${item.icon_color}`}><Icon className="w-4 h-4" /></div>
                                <div className="flex-grow">
                                    <p className="text-sm text-gray-800"><span className="font-bold text-indigo-600">{item.child_name}</span> — {item.description}</p>
                                    <p className="text-xs text-gray-400 mt-1">{item.time}</p>
                                </div>
                                <ChevronRight className="w-4 h-4 text-gray-300 mt-1" />
                            </motion.div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default ParentTodayWidget;
