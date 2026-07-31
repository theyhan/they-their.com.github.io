# 이벤트 분류 체계 (Event Taxonomy) v1.1

v1.0 §22의 KPI를 실제로 계산할 수 있게 만드는 문서입니다. 두 가지 규칙을 코드로 강제합니다.

1. **등록되지 않은 이벤트 이름은 `emit()`에서 예외를 던진다.** 분석 스키마 드리프트를 막습니다.
2. **모든 KPI는 최소 1개 이벤트에 매핑된다.** 매핑이 없는 KPI는 측정 불가로 간주해 삭제합니다.

구현: `assets/js/core/store.js`의 `EVENTS`, `emit()`, `kpiSnapshot()`.

---

## 리댁션 규칙

- 이벤트 속성의 모든 문자열은 전송 전에 PII 리댁션(`domain/story.js`의 `redact()`)을 통과한다.
- 60자를 넘는 문자열은 잘라낸다. 스토리 원문은 어떤 경우에도 분석 파이프라인에 들어가지 않는다.
- 객체 값은 `[object]`로 대체한다. 중첩 페이로드를 실수로 흘리지 않기 위한 안전장치다.
- 감사 로그(`audit`)는 분석 이벤트와 **별도 저장소**를 쓴다. 목적이 다르고 보관 기간이 다르다.

---

## 이벤트 목록

| 이벤트 | 발생 시점 | 주요 속성 | KPI |
|---|---|---|---|
| `onboarding_started` | 온보딩 진입 | — | — |
| `dna_pairwise_answered` | 샘플 비교에서 한쪽 선택 | item, side | — |
| `dna_onboarding_completed` | 온보딩 완료 | dimensions | — |
| `dna_preference_corrected` | 사용자가 추천값을 바꿈 | dimension | `dna_correction_rate` |
| `dna_signal_deleted` | 신호 삭제 | signalId \| all | — |
| `dna_reset` | 프로필 초기화 | — | — |
| `project_created` | 상황 선택 후 프로젝트 생성 | occasion | `story_intake_completion_rate`(분모) |
| `story_step_completed` | 인테이크 답변 제출 | fields | `story_intake_completion_rate` |
| `story_approved` | 스토리 요약 승인 | facts | `story_intake_completion_rate`(분자) |
| `request_screened` | 요청 스크리닝 실행 | decision, findings | `screening_block_rate` |
| `lyrics_generated` | 가사 초안 생성 | language, sections | `lyric_approval_rate`(분모) |
| `lyrics_edited` | 가사 줄 수정 | lineId | `lyric_edit_distance` |
| `lyrics_line_locked` | 줄 잠금/해제 | lineId | — |
| `lyrics_section_regenerated` | 구간 가사 재생성 | section | `regeneration_rate` |
| `lyrics_approved` | 가사 승인 | editDistance, coverage | `lyric_approval_rate`(분자) |
| `generation_started` | 유료 생성 시작 | specId, variants | `paid_conversion_rate` |
| `generation_progress` | 구간 렌더 진행 | sectionId, done, total | — |
| `generation_completed` | A/B 생성 완료 | renderMsA, renderMsB, cachedB | `generation_success_rate` |
| `generation_failed` | 생성 실패 | message | `generation_success_rate`, `generation_failure_rate` |
| `similarity_checked` | 유사도 검사 완료 | variant, decision, score | `similarity_failure_rate` |
| `variant_played` | 버전 재생 | variant | — |
| `variant_selected` | 버전 선택 | variant, axes | `ab_selection_rate` |
| `revision_requested` | 수정 요청 | intent, text, variant | `revisions_per_song` |
| `revision_completed` | 수정 반영 완료 | intent, rerendered, sections, mode | `revisions_per_song`, `section_patch_ratio` |
| `finalized` | 최종 확정 | variant, revisions | — |
| `license_issued` | 라이선스 발급 | tier | `license_attach_rate` |
| `download_completed` | 파일 다운로드 | asset, bits | `final_download_rate` |
| `share_created` | 공유 링크 생성 | shareId | `recipient_share_rate` |
| `share_opened` | 공유 링크 열림 | shareId | `recipient_share_rate` |
| `rating_submitted` | 첫 생성 만족도 | rating | `first_generation_rating` |
| `refund_requested` | 환불 요청 | reason | `refund_rate` |
| `abuse_reported` | 신고 | source | — |
| `project_deleted` | 프로젝트 삭제 | — | — |

---

## KPI 계산식

v1.0 §22의 항목에 분모를 명시했습니다. 분모 합의가 없으면 같은 지표를 두 사람이
다르게 계산합니다.

| KPI | 계산식 |
|---|---|
| 스토리 인테이크 완료율 | `story_approved` / `project_created` |
| 가사 승인율 | `lyrics_approved` / `lyrics_generated` |
| 유료 전환율 | `license_issued` / `project_created` |
| A/B 선택률 | `variant_selected(A)` / `variant_selected(*)`, **축별로도 집계** |
| 곡당 평균 수정 횟수 | `revision_completed` / 완성 프로젝트 수 |
| 최종 다운로드율 | `download_completed(master_wav)` distinct project / `project_created` |
| 수신자 재생·공유율 | `share_opened` distinct / `share_created` |
| 첫 생성 만족도 | `rating_submitted.rating` 평균 |
| 스토리 사실 보존율 | `lyrics_approved.coverage` 평균 |
| 승인 전 가사 수정 거리 | `lyrics_approved.editDistance` 평균 (정규화 값 병기) |
| 유사도 실패율 | `similarity_checked(decision != pass)` / `similarity_checked` |
| 결함 재생성율 | `generation_failed` + `quarantined` 진입 / `generation_started` |
| 구간 패치 비율 (신규) | `revision_completed(mode=section_patch)` / `revision_completed` |
| 스크리닝 차단율 (신규) | `request_screened(decision=block)` / `request_screened` |
| 완성 프로젝트당 원가 (신규) | `CostLedgerEntry` 합계 / 완성 프로젝트 수 |

`section_patch_ratio`가 낮으면 프로바이더가 구간 수정을 실질적으로 지원하지 않는다는
뜻이고, 그건 원가와 대기 시간에 직접 반영됩니다. 그래서 신규 지표에 넣었습니다.
