"use strict";

// Shared UI labels used by history, understanding, commands and Thought Tree.
// Keep persisted Markdown fields and provider prompts independent of UI language.
const rows = [
  ['timeout must be a number of seconds.', 'timeout must be a number of seconds.', 'タイムアウトには秒数を入力してください。', '시간 제한은 초 단위 숫자로 입력하세요.'],
  ['timeoutMs must be an integer between 10000 and 300000.', 'timeoutMs must be an integer between 10000 and 300000.', 'タイムアウトは 10〜300 秒にしてください。', '시간 제한은 10~300초여야 합니다.'],
  ['model must be a non-empty model id without spaces.', 'model must be a non-empty model id without spaces.', '空白を含まないモデル ID を入力してください。', '공백 없는 모델 ID를 입력하세요.'],
  ['apiKeySecretName must be a lowercase secret name (letters, digits, dashes).', 'apiKeySecretName must be a lowercase secret name (letters, digits, dashes).', 'シークレット名には英小文字・数字・ハイフンを使用してください。', '비밀 키 이름에는 영문 소문자, 숫자, 하이픈을 사용하세요.'],
  ['baseUrl must be a non-empty URL.', 'baseUrl must be a non-empty URL.', '有効な URL を入力してください。', '유효한 URL을 입력하세요.'],
  ['baseUrl is not a valid URL.', 'baseUrl is not a valid URL.', 'URL の形式が正しくありません。', 'URL 형식이 올바르지 않습니다.'],
  ['baseUrl must use https:// (plain http:// is allowed only for localhost).', 'baseUrl must use https:// (plain http:// is allowed only for localhost).', 'https:// を使用してください。http:// はローカルホストのみ使用できます。', 'https://를 사용하세요. http://는 localhost에서만 허용됩니다.'],
  ['baseUrl must not contain credentials.', 'baseUrl must not contain credentials.', 'URL に認証情報を含めないでください。', 'URL에 인증 정보를 포함할 수 없습니다.'],
  ['baseUrl must not contain a query or fragment.', 'baseUrl must not contain a query or fragment.', 'URL にクエリやフラグメントを含めないでください。', 'URL에 쿼리나 프래그먼트를 포함할 수 없습니다.'],
  ['返回当前讨论', 'Return to current discussion', '現在の対話に戻る', '현재 대화로 돌아가기'],
  ['历史讨论 · 只读', 'Saved discussion · Read-only', '保存した対話 · 閲覧専用', '저장된 대화 · 읽기 전용'],
  ['未命名讨论', 'Untitled discussion', '無題の対話', '제목 없는 대화'],
  ['原文', 'Original text', '原文', '원문'],
  ['我', 'Me', '自分', '나'],
  ['我的理解', 'My understanding', '自分の理解', '내가 이해한 내용'],
  ['我写的', 'Written by me', '自分で記述', '직접 작성'],
  ['AI 起草 · 我改过', 'AI draft · Edited by me', 'AI の下書き · 編集済み', 'AI 초안 · 직접 수정'],
  ['AI 起草 · 已确认', 'AI draft · Confirmed', 'AI の下書き · 確認済み', 'AI 초안 · 확인됨'],
  ['✓ 想明白了', '✓ Understood', '✓ 理解できた', '✓ 이해했어요'],
  ['○ 还没想透', '○ Still thinking', '○ まだ考え中', '○ 아직 생각 중이에요'],
  ['未总结', 'Not summarized', '未整理', '정리 안 됨'],
  ['查看原文', 'Open source', '原文を開く', '원문 열기'],
  ['基于此原文开始新讨论', 'Start a new discussion from this passage', 'この原文から新しい対話を始める', '이 원문으로 새 대화 시작'],
  ['+ 写下我的理解', '+ Write my understanding', '+ 自分の理解を書く', '+ 내가 이해한 내용 쓰기'],
  ['编辑', 'Edit', '編集', '편집'],
  ['AI 起草 · 可直接修改', 'AI draft · You can edit it', 'AI の下書き · 編集できます', 'AI 초안 · 바로 수정 가능'],
  ['这次讨论之后，你想明白了什么？用一两句话写下来。', 'What did you understand after this discussion? Write a sentence or two.', 'この対話で何がわかりましたか？1〜2 文で書いてみましょう。', '이번 대화로 무엇을 이해했나요? 한두 문장으로 적어 보세요.'],
  ['用自己的话写下你的理解…', 'Write your understanding in your own words…', '自分の言葉で理解したことを書く…', '이해한 내용을 자신의 말로 적어 보세요…'],
  ['先写一句理解再保存', 'Write your understanding before saving', '理解したことを書いてから保存してください', '이해한 내용을 먼저 적고 저장하세요'],
  ['重新起草', 'Draft again', '下書きを再生成', '초안 다시 작성'],
  ['让 AI 起草一版', 'Ask AI for a draft', 'AI に下書きを依頼', 'AI에게 초안 요청'],
  ['跳过', 'Skip', 'スキップ', '건너뛰기'],
  ['保存为', 'Save as', '保存する状態', '저장 상태'],
  ['还没想透', 'Still thinking', 'まだ考え中', '아직 생각 중이에요'],
  ['想明白了', 'Understood', '理解できた', '이해했어요'],
  ['写一句再保存', 'Write a sentence before saving', '一文書いてから保存してください', '한 문장을 적고 저장하세요'],
  ['AI 起草失败', 'AI draft failed', 'AI の下書きを生成できませんでした', 'AI 초안 작성 실패'],
  ['笔记中的讨论已被修改，请核对后再保存', 'The discussion in the note has changed. Review it before saving.', 'ノート内の対話が変更されています。確認してから保存してください。', '노트의 대화가 변경되었습니다. 확인 후 저장하세요.'],
  ['已解决', 'Resolved', '解決済み', '해결됨'],
  ['未解决', 'Unresolved', '未解決', '미해결'],
  ['{n} 条', '{n} discussions', '{n} 件', '{n}개'],
  ['历史讨论已变化，请重新打开 PDF。', 'The saved discussion has changed. Reopen the PDF.', '保存した対話が変更されています。PDF を開き直してください。', '저장된 대화가 변경되었습니다. PDF를 다시 여세요.'],
  ['Generate / Update Thought Tree Archive', 'Generate / Update Thought Tree Archive', '思考ツリーのアーカイブを生成・更新', '생각 트리 보관 파일 생성 / 갱신'],
  ['Backleaf Thought Tree', 'Backleaf Thought Tree', 'Backleaf 思考ツリー', 'Backleaf 생각 트리'],
  ['Open Backleaf Thought Tree', 'Open Backleaf Thought Tree', 'Backleaf 思考ツリーを開く', 'Backleaf 생각 트리 열기'],
  ['思考树存档已更新。', 'Thought Tree archive updated.', '思考ツリーのアーカイブを更新しました。', '생각 트리 보관 파일을 갱신했습니다.'],
  ['思考树存档已生成。', 'Thought Tree archive created.', '思考ツリーのアーカイブを生成しました。', '생각 트리 보관 파일을 생성했습니다.'],
  ['当前文件不是 Reading Note，未生成思考树存档。', 'The current file is not a Reading Note. No archive was created.', '現在のファイルは読書ノートではありません。アーカイブは生成されませんでした。', '현재 파일은 독서 노트가 아닙니다. 보관 파일을 생성하지 않았습니다.'],
  ['当前文件不在 Books/Reading Notes 中，未生成思考树存档。', 'The file is not in Books/Reading Notes. No archive was created.', 'ファイルが Books/Reading Notes 内にありません。アーカイブは生成されませんでした。', '파일이 Books/Reading Notes에 없습니다. 보관 파일을 생성하지 않았습니다.'],
  ['当前 Reading Note 不存在，未生成思考树存档。', 'The Reading Note does not exist. No archive was created.', '読書ノートが存在しません。アーカイブは生成されませんでした。', '독서 노트가 없습니다. 보관 파일을 생성하지 않았습니다.'],
  ['当前文件不是合法 Reading Note，未生成思考树存档。', 'The file is not a valid Reading Note. No archive was created.', '有効な読書ノートではありません。アーカイブは生成されませんでした。', '올바른 독서 노트가 아닙니다. 보관 파일을 생성하지 않았습니다.'],
  ['目标路径已存在但不是文件，未覆盖。', 'The target exists but is not a file. Nothing was overwritten.', '保存先は存在しますがファイルではありません。上書きしていません。', '대상 경로가 존재하지만 파일이 아닙니다. 덮어쓰지 않았습니다.'],
  ['目标文件已存在，但不是当前读书笔记的 Backleaf 思考树存档，未覆盖。', 'The target is not this note’s Backleaf Thought Tree archive. Nothing was overwritten.', '保存先はこの読書ノートの Backleaf 思考ツリーアーカイブではありません。上書きしていません。', '대상이 이 독서 노트의 Backleaf 생각 트리 보관 파일이 아닙니다. 덮어쓰지 않았습니다.'],
  ['这条讨论在笔记中已被修改。请打开读书笔记核对；当前对话仍保留在本次会话中。', 'This discussion was changed in the note. Open the reading note to review it; the current conversation is still available in this session.', 'ノート内の対話が変更されています。読書ノートを開いて確認してください。現在の会話はこのセッションに保持されています。', '노트의 대화가 변경되었습니다. 독서 노트를 열어 확인하세요. 현재 대화는 이번 세션에 유지됩니다.'],
];

const translations = new Map(rows.map(([zh, en, ja, ko]) => [zh, { 'zh-CN': zh, en, ja, ko }]));
function translateUi(value, locale) {
  return translations.get(value)?.[locale] ?? value;
}

module.exports = { translateUi, rows };
