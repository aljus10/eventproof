package org.eventproof.attendance;

import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

@Service
public class AttendanceEvents {
    private final Map<Long, CopyOnWriteArrayList<SseEmitter>> emitters = new ConcurrentHashMap<>();

    public SseEmitter subscribe(Long eventId) {
        SseEmitter emitter = new SseEmitter(30L * 60L * 1000L);
        emitters.computeIfAbsent(eventId, id -> new CopyOnWriteArrayList<>()).add(emitter);
        Runnable cleanup = () -> remove(eventId, emitter);
        emitter.onCompletion(cleanup);
        emitter.onTimeout(cleanup);
        emitter.onError(ex -> cleanup.run());
        try {
            emitter.send(SseEmitter.event().name("connected").data("ok"));
        } catch (IOException e) {
            cleanup.run();
        }
        return emitter;
    }

    public void attendanceChanged(Long eventId) {
        List<SseEmitter> list = emitters.get(eventId);
        if (list == null) return;
        for (SseEmitter emitter : list) {
            try {
                emitter.send(SseEmitter.event().name("attendance").data("changed"));
            } catch (IOException e) {
                remove(eventId, emitter);
            }
        }
    }

    private void remove(Long eventId, SseEmitter emitter) {
        List<SseEmitter> list = emitters.get(eventId);
        if (list != null) list.remove(emitter);
    }
}
