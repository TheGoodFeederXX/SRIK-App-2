import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { AnnouncementCategory, Notice } from '../../types';
import { CameraIcon, StopIcon, XCircleIcon, VideoIcon } from '../../constants';
import { saveAnnouncement } from '../../src/lib/supabase/announcements';
import { uploadFile } from '../../src/lib/supabase/storage';
import { useAuth } from '../../context/AuthContext';
import { getMyTeacherProfileCached } from '../../lib/queryClient';

import { useTeacherClasses } from '../../hooks/useTeacherClasses';

const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const TeacherCommunicationScreen: React.FC = () => {
    const { t } = useTranslation();
    const { user } = useAuth();
    const [classes, setClasses] = useState<any[]>([]);
    const [mode, setMode] = useState<'text' | 'video'>('text');
    const [selectedClasses, setSelectedClasses] = useState<Set<string>>(new Set());
    const [selectedCategory, setSelectedCategory] = useState<AnnouncementCategory>('General');
    const [title, setTitle] = useState('');
    const [message, setMessage] = useState('');
    const [teacherName, setTeacherName] = useState('');

    // Video state
    const [isRecording, setIsRecording] = useState(false);
    const [videoBlobUrl, setVideoBlobUrl] = useState<string | null>(null);
    const [recordingTime, setRecordingTime] = useState(0);
    const videoRef = useRef<HTMLVideoElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const recordingIntervalRef = useRef<number | null>(null);

    const { classes: teacherClasses, loading: classesLoading } = useTeacherClasses(user?.id);

    // Fetch Classes and Teacher Name
    useEffect(() => {
        const fetchMeta = async () => {
            if (!user) return;
            // Get Teacher via backend API
            try {
                const teacher = await getMyTeacherProfileCached();
                if (teacher) {
                    // NO `school_id`. There is one school, and `teachers` has no such
                    // column — the field was read, stored and never used.
                    setTeacherName(teacher.name || teacher.full_name || '');
                }
            } catch (err) {
                console.error('Error fetching teacher profile:', err);
            }

            // Group Classes from Hook
            if (teacherClasses) {
                setClasses(teacherClasses.map(c => ({
                    id: c.id,
                    name: c.name
                })));
            }
        };
        if (!classesLoading) fetchMeta();
    }, [user, teacherClasses, classesLoading]);

    const handleClassToggle = (className: string) => {
        const newSelection = new Set(selectedClasses);
        if (newSelection.has(className)) {
            newSelection.delete(className);
        } else {
            newSelection.add(className);
        }
        setSelectedClasses(newSelection);
    };

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedClasses.size === 0 || !title) {
            toast.error(t('teacherCommunicationScreen.pleaseSelectAtLeastOneClassAndProvideATitle'));
            return;
        }
        if (mode === 'text' && !message) {
            toast.error(t('teacherCommunicationScreen.pleaseProvideAMessageForTheTextAnnouncement'));
            return;
        }
        if (mode === 'video' && !videoBlobUrl) {
            toast.error(t('teacherCommunicationScreen.pleaseRecordOrProvideAVideoForTheVideoAnnounce'));
            return;
        }

        try {
            const audienceArray = Array.from(selectedClasses);

            // A recorded video is now REALLY uploaded and linked into the notice,
            // so recipients can actually watch it — no more silently dropping it.
            let content = message || '';
            if (mode === 'video' && videoBlobUrl) {
                const blob = await fetch(videoBlobUrl).then(r => r.blob());
                const file = new File([blob], `announcement-${Date.now()}.webm`, { type: blob.type || 'video/webm' });
                const uploaded = await uploadFile({ type: 'SCHOOL' }, file);
                content = `${message ? message + '\n\n' : ''}📹 Video: ${uploaded.storageKey}`;
            }

            // THE REAL NOTICE. `announcements` carries title, body, audience and status —
            // and nothing else. The old payload sent `category`, `is_pinned`, `school_id`
            // and a `timestamp`: none is a column, and `school_id` does not exist anywhere
            // in this database. The notice went to an undeployed server.
            //
            // A teacher does not choose the audience per notice — the school does, through
            // permissions. A notice written here goes to STAFF: the teacher's own
            // colleagues. Publishing to families is the office's deliberate act, and
            // `saveAnnouncement` always creates a DRAFT for exactly that reason.
            await saveAnnouncement({
                title: title || 'Pengumuman',
                body: content || '(Pengumuman)',
                audience: 'STAFF',
            });

            toast.success(`${t('teacherCommunicationScreen.pengumumanDisimpanSebagaiDrafUntuk')}: ${audienceArray.join(', ')}`);
            // Reset form
            setSelectedClasses(new Set());
            setTitle('');
            setMessage('');
            setVideoBlobUrl(null);
            setMode('text');
        } catch (err: any) {
            console.error("Error sending notice:", err);
            toast.error(t('teacherCommunicationScreen.failedToSendNotice') + err.message);
        }
    };

    const stopStream = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
    };

    useEffect(() => {
        // Cleanup stream on component unmount
        return () => stopStream();
    }, []);

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            streamRef.current = stream;
            if (videoRef.current) videoRef.current.srcObject = stream;

            const recorder = new MediaRecorder(stream);
            mediaRecorderRef.current = recorder;
            const chunks: Blob[] = [];
            recorder.ondataavailable = (event) => chunks.push(event.data);
            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'video/webm' });
                setVideoBlobUrl(URL.createObjectURL(blob));
                stopStream();
            };
            recorder.start();
            setIsRecording(true);
            setRecordingTime(0);
            recordingIntervalRef.current = window.setInterval(() => setRecordingTime(t => t + 1), 1000);
        } catch (err) {
            console.error(err);
            toast.error(t('teacherCommunicationScreen.cameraMicrophonePermissionDeniedPleaseEnableIt'));
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
        }
    };

    const handleDiscardVideo = () => {
        setVideoBlobUrl(null);
        setRecordingTime(0);
    };

    const VideoRecorderUI = () => (
        <div className="bg-white p-4 rounded-xl shadow-sm space-y-3">
            <div className="w-full aspect-video bg-black rounded-lg overflow-hidden relative">
                <video ref={videoRef} autoPlay muted className="w-full h-full object-cover"></video>
                {isRecording && <div className="absolute top-2 right-2 text-white bg-red-500 px-2 py-0.5 rounded text-xs font-mono">REC {formatTime(recordingTime)}</div>}
            </div>
            <div className="flex justify-center">
                {isRecording ? (
                    <button type="button" onClick={stopRecording} className="p-4 bg-red-500 text-white rounded-full shadow-lg"><StopIcon /></button>
                ) : (
                    <button type="button" onClick={startRecording} className="p-4 bg-gray-700 text-white rounded-full shadow-lg"><CameraIcon /></button>
                )}
            </div>
        </div>
    );

    const VideoPreviewUI = () => {
    const { t } = useTranslation();
    return (
        <div className="bg-white p-4 rounded-xl shadow-sm space-y-3">
            <video src={videoBlobUrl!} controls className="w-full aspect-video bg-black rounded-lg"></video>
            <div className="grid grid-cols-2 gap-3 items-center">
                <button type="button" onClick={handleDiscardVideo} className="w-full py-2 bg-gray-200 text-gray-800 font-bold rounded-lg">{t('teacherCommunicationScreen.discard')}</button>
                <div className="w-full flex items-center justify-center gap-1.5 text-green-700 font-semibold text-sm" aria-live="polite">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    Video Attached
                </div>
            </div>
        </div>
    );
};

    return (
        <div className="flex flex-col h-full bg-gray-100">
            <form onSubmit={handleSend} className="flex-grow flex flex-col">
                <main className="flex-grow p-4 overflow-y-auto">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                        <div className="lg:col-span-1 space-y-5 lg:sticky lg:top-6 lg:self-start">
                            <div>
                                <h3 className="text-lg font-bold text-gray-800 mb-2">{t('teacherCommunicationScreen.1SelectClasses')}</h3>
                                <div className="grid grid-cols-2 gap-3">
                                    {classes.map(cls => {
                                        const className = cls.name;
                                        const isSelected = selectedClasses.has(className);
                                        return (
                                            <button type="button" key={cls.id} onClick={() => handleClassToggle(className)} className={`p-4 bg-white rounded-xl shadow-sm text-center border-2 ${isSelected ? 'border-purple-500' : 'border-transparent'}`} aria-pressed={isSelected}>
                                                <p className="font-bold text-gray-800">{className}</p>
                                            </button>
                                        );
                                    })}
                                    {classesLoading && <p className="text-sm text-gray-500 col-span-2">{t('teacherCommunicationScreen.loadingYourClasses')}</p>}
                                    {/* classesLoading gates fetchMeta (see effect above) but not this
                                        render — `classes` stays [] for the whole loading window, which
                                        used to show "No classes found" before the fetch had a chance to
                                        finish, not just when it genuinely came back empty. */}
                                    {!classesLoading && classes.length === 0 && <p className="text-sm text-gray-500 col-span-2">{t('teacherCommunicationScreen.noClassesFoundAssignedToYou')}</p>}
                                </div>
                            </div>

                            <div>
                                <h3 className="text-lg font-bold text-gray-800 mb-2">{t('teacherCommunicationScreen.2AnnouncementType')}</h3>
                                <div className="flex space-x-1 bg-gray-200 p-1 rounded-lg">
                                    <button type="button" onClick={() => { setMode('text'); stopStream(); }} className={`w-1/2 py-2 text-sm font-semibold rounded-md ${mode === 'text' ? 'bg-white shadow' : 'text-gray-600'}`}>Text</button>
                                    <button type="button" onClick={() => setMode('video')} className={`w-1/2 py-2 text-sm font-semibold rounded-md ${mode === 'video' ? 'bg-white shadow' : 'text-gray-600'}`}>Video</button>
                                </div>
                            </div>

                            <div>
                                <label htmlFor="announcement-category" className="text-lg font-bold text-gray-800 mb-2 block">{t('teacherCommunicationScreen.category')}</label>
                                <select
                                    id="announcement-category"
                                    value={selectedCategory}
                                    onChange={(e) => setSelectedCategory(e.target.value as AnnouncementCategory)}
                                    className="w-full px-4 py-2 text-gray-800 bg-white border rounded-lg font-semibold shadow-sm"
                                >
                                    <option value="General">{t('teacherCommunicationScreen.general')}</option>
                                    <option value="Homework">{t('teacherCommunicationScreen.homework')}</option>
                                    <option value="Test Reminder">{t('teacherCommunicationScreen.testReminder')}</option>
                                    <option value="Event">Event</option>
                                    <option value="Urgent">Urgent</option>
                                    <option value="Holiday">{t('teacherCommunicationScreen.holiday')}</option>
                                </select>
                            </div>
                        </div>

                        <div className="lg:col-span-2">
                            <h3 className="text-lg font-bold text-gray-800 mb-2">{t('teacherCommunicationScreen.3ComposeMessage')}</h3>
                            <div className="space-y-4">
                                <div className="bg-white p-4 rounded-xl shadow-sm space-y-4">
                                    <input id="announcement-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('teacherCommunicationScreen.announcementTitle')} required className="w-full px-4 py-2 text-gray-800 bg-gray-50 border rounded-lg font-semibold" />
                                    {mode === 'text' && (
                                        <textarea id="announcement-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={10} placeholder={t('teacherCommunicationScreen.typeYourMessageHere')} className="w-full px-4 py-2 text-gray-700 bg-gray-50 border rounded-lg" />
                                    )}
                                </div>
                                {mode === 'video' && !videoBlobUrl && <VideoRecorderUI />}
                                {mode === 'video' && videoBlobUrl && <VideoPreviewUI />}
                            </div>
                        </div>
                    </div>
                </main>
                <div className="p-4 mt-auto bg-white border-t border-gray-200">
                    <button type="submit" className="w-full flex justify-center py-3 px-4 rounded-lg shadow-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400">
                        {t('teacherCommunicationScreen.sendAnnouncement')}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default TeacherCommunicationScreen;
