// --- [Phase 1: SSOT JSON 추출 유틸리티 함수 (Raw Data)] ---
// [SSOT 표준] width / height: number | "fill" | "hug" 만 허용 ({type:"fixed"} 절대 금지)
// [SSOT 표준] layout: { mode: "HORIZONTAL"|"VERTICAL", padding: "token.*", spacing: "token.*" }

function reverseTokenizeSpacing(value) {
  if (typeof value !== 'number' || value === 0) return "token.spacing.none";
  if (value <= 4) return "token.spacing.xs";
  if (value <= 8) return "token.spacing.sm";
  if (value <= 16) return "token.spacing.md";
  if (value <= 24) return "token.spacing.lg";
  if (value <= 32) return "token.spacing.xl";
  return "token.spacing.xxl";
}

// [확정] 반환값: 숫자 | "fill" | "hug" — "fixed" 문자열은 절대 반환하지 않습니다.
function getSizingMode(node, axis) {
  if (axis === "HORIZONTAL") {
    if (node.layoutSizingHorizontal === "FILL" || node.layoutGrow === 1) return "fill";
    if (node.layoutSizingHorizontal === "HUG") return "hug";
    return Math.round(node.width || 100); // 숫자 반환 (렌더링 엔진의 resize() 처리용)
  } else {
    if (node.layoutSizingVertical === "FILL" || node.layoutAlign === "STRETCH") return "fill";
    if (node.layoutSizingVertical === "HUG") return "hug";
    return Math.round(node.height || 100); // 숫자 반환 (렌더링 엔진의 resize() 처리용)
  }
}

function determineRole(node) {
  const name = (node.name || "").toLowerCase();
  if (name.includes("thumbnail") || name.includes("thumb")) return "thumbnail";
  if (name.includes("title")) return "title";
  if (name.includes("desc") || name.includes("sub")) return "description";
  if (name.includes("btn") || name.includes("button")) return "button";
  if (name.includes("icon")) return "icon";
  return "default";
}

function determineType(node) {
  if (node.type === "TEXT") return "text";
  const isImageFill = node.fills && Array.isArray(node.fills) && node.fills.some(f => f.type === "IMAGE");
  if (node.type === "IMAGE" || isImageFill) return "image";
  if (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE") return "frame";
  if (node.type === "GROUP") return "container";
  return "container";
}

function extractNodeToJSON(node) {
  const nodeType = determineType(node);
  const json = {
    id: node.id,
    type: nodeType
  };

  if (nodeType === "frame" || nodeType === "container") {
    // [FIXED] layout 구조: mode 대문자, token 기반 spacing/padding
    const hasAutoLayout = node.layoutMode === "HORIZONTAL" || node.layoutMode === "VERTICAL";
    json.layout = {
      mode: hasAutoLayout ? node.layoutMode : "VERTICAL", // 대문자 강제
      padding: reverseTokenizeSpacing(Math.max(node.paddingLeft || 0, node.paddingTop || 0)),
      spacing: reverseTokenizeSpacing(node.itemSpacing || 0)
    };
    json.style = {
      width: getSizingMode(node, "HORIZONTAL"),  // number | "fill" | "hug"
      height: getSizingMode(node, "VERTICAL")    // number | "fill" | "hug"
    };
    json.children = [];
    if (node.children && node.children.length > 0) {
      json.children = node.children.map(child => extractNodeToJSON(child));
    }
  }

  if (nodeType === "image" || nodeType === "text" || nodeType === "container") {
    json.role = determineRole(node);
    if (nodeType === "text") {
      json.content = node.characters || "";
    }

    json.style = json.style || {};
    json.style.width = getSizingMode(node, "HORIZONTAL");  // number | "fill" | "hug"
    json.style.height = getSizingMode(node, "VERTICAL");   // number | "fill" | "hug"

    let alignMode = "MIN"; // ⭐️ START를 MIN으로 변경
    if (node.layoutAlign === "CENTER") alignMode = "CENTER";
    if (node.layoutAlign === "MAX") alignMode = "MAX";

    json.layoutRules = {
      grow: node.layoutGrow || 0,
      align: alignMode
    };

    if (nodeType === "image") {
      const w = Math.round(node.width || 1);
      const h = Math.round(node.height || 1);
      json.layoutRules.ratio = (w === h) ? "1:1" : "16:9";
    }
  }

  return json;
}

// --- [Phase 2: Normalize Engine (SSOT 포맷팅 전용 — 구조 조작 금지)] ---
// 역할: extractNodeToJSON의 raw data를 SSOT 표준 스키마로 포맷팅만 수행.
// 금지: 트리 구조 변경, 역할 추론, 자동 평탄화 등 결정론적 원칙 위반 로직.

// SSOT 표준 검증: width/height가 허용 타입인지 확인
function assertValidSize(value, fieldName) {
  if (value === "fill" || value === "hug") return value;
  if (typeof value === "number" && !isNaN(value)) return value;
  console.warn(`[SSOT 경고] ${fieldName} 값 "${value}"은 유효하지 않습니다. "hug"로 대체합니다.`);
  return "hug"; // 안전한 대체값
}

// SSOT 표준 검증: layout 객체 구조 보장
function ensureLayoutObject(layout) {
  if (!layout || typeof layout !== "object") {
    return { mode: "VERTICAL", padding: "token.spacing.none", spacing: "token.spacing.none" };
  }
  return {
    mode: (layout.mode && ["HORIZONTAL", "VERTICAL"].includes(String(layout.mode).toUpperCase()))
      ? String(layout.mode).toUpperCase()
      : "VERTICAL",
    padding: (typeof layout.padding === "string" && layout.padding.includes("token"))
      ? layout.padding : "token.spacing.none",
    spacing: (typeof layout.spacing === "string" && layout.spacing.includes("token"))
      ? layout.spacing : "token.spacing.none"
  };
}

// 단일 노드를 SSOT 표준 스키마로 포맷팅 (구조 변경 없음)
function formatNodeToSSOT(rawNode) {
  if (!rawNode) return null;

  const node = Object.assign({}, rawNode);

  // style 포맷팅: width/height 유효성 보장
  if (node.style) {
    node.style = Object.assign({}, node.style, {
      width: assertValidSize(node.style.width, "style.width"),
      height: assertValidSize(node.style.height, "style.height")
    });
  }

  // layout 포맷팅: frame/container 타입에 대해 표준 layout 객체 보장
  if (node.type === "frame" || node.type === "container") {
    node.layout = ensureLayoutObject(node.layout);
  }

  // content fallback: text 노드의 undefined/null 방어
  if (node.type === "text") {
    node.content = (node.content !== undefined && node.content !== null) ? String(node.content) : "";
  }

  // 자식 노드 재귀 포맷팅 (구조 유지)
  if (node.children && Array.isArray(node.children)) {
    node.children = node.children.map(child => formatNodeToSSOT(child)).filter(Boolean);
  }

  return node;
}

// processFigmaJSON: Extract → Format (AI 추론 단계 제거)
async function processFigmaJSON(rawJSON) {
  return formatNodeToSSOT(rawJSON);
}


// --- [Phase 3: Render Engine (JSON to Auto Layout)] ---

const TOKEN_DICTIONARY = {
  "token.spacing.xs": 4,
  "token.spacing.sm": 8,
  "token.spacing.md": 16,
  "token.spacing.lg": 24,
  "token.spacing.xl": 32,
  "token.spacing.none": 0
};

function resolveToken(value) {
  if (typeof value === "string" && TOKEN_DICTIONARY[value] !== undefined) {
    return TOKEN_DICTIONARY[value];
  }
  return typeof value === "number" ? value : 0;
}

function createFrame(node) {
  return figma.createFrame();
}

async function createText(node) {
  const textNode = figma.createText();

  const family = (node.fontName && node.fontName.family) ? String(node.fontName.family) : "Inter";
  const style = (node.fontName && node.fontName.style) ? String(node.fontName.style) : "Regular";

  await figma.loadFontAsync({ family, style });

  if (node.fontName) {
    textNode.fontName = { family, style };
  }

  if (node.characters !== undefined) {
    textNode.characters = String(node.characters);
  } else if (node.content !== undefined) {
    textNode.characters = String(node.content);
  }

  if (node.fontSize !== undefined) {
    textNode.fontSize = Number(node.fontSize);
  }

  if (node.color) {
    textNode.fills = [{ type: 'SOLID', color: node.color }];
  }

  return textNode;
}

function createImage(node) {
  const rect = figma.createRectangle();
  if (node.imageData) {
    const image = figma.createImage(node.imageData);
    rect.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }];
  } else {
    rect.fills = [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8 } }];
  }
  return rect;
}

function applyLayout(node, figmaNode) {
  if (node.layout && figmaNode.type === "FRAME") {
    if (node.layout.mode) {
      figmaNode.layoutMode = String(node.layout.mode).toUpperCase();
    }
    if (node.layout.spacing !== undefined) {
      figmaNode.itemSpacing = resolveToken(node.layout.spacing);
    }
    if (node.layout.padding !== undefined) {
      const p = node.layout.padding;
      if (typeof p === "string" || typeof p === "number") {
        const val = resolveToken(p);
        figmaNode.paddingTop = val;
        figmaNode.paddingRight = val;
        figmaNode.paddingBottom = val;
        figmaNode.paddingLeft = val;
      } else if (typeof p === "object") {
        if (p.top !== undefined) figmaNode.paddingTop = resolveToken(p.top);
        if (p.bottom !== undefined) figmaNode.paddingBottom = resolveToken(p.bottom);
        if (p.left !== undefined) figmaNode.paddingLeft = resolveToken(p.left);
        if (p.right !== undefined) figmaNode.paddingRight = resolveToken(p.right);
      }
    }
  }

  if (node.layoutRules) {
    const isParentAutoLayout = figmaNode.parent && "layoutMode" in figmaNode.parent && figmaNode.parent.layoutMode !== "NONE";
    if (isParentAutoLayout && "layoutGrow" in figmaNode) {
      if (node.layoutRules.grow !== undefined) {
        figmaNode.layoutGrow = Number(node.layoutRules.grow);
      }
      if (node.layoutRules.align !== undefined && "layoutAlign" in figmaNode) {
        figmaNode.layoutAlign = String(node.layoutRules.align).toUpperCase();
      }
    }
  }
}

function applyStyle(node, figmaNode) {
  if (!node.style) return;

  const isParentAutoLayout = figmaNode.parent && "layoutMode" in figmaNode.parent && figmaNode.parent.layoutMode !== "NONE";
  let hasFillOrHug = false;

  if (node.style.width !== undefined) {
    const w = String(node.style.width).toLowerCase();
    if (w === "fill" || w === "hug") {
      if (isParentAutoLayout && "layoutSizingHorizontal" in figmaNode) {
        figmaNode.layoutSizingHorizontal = w.toUpperCase();
      }
      hasFillOrHug = true;
    }
  }

  if (node.style.height !== undefined) {
    const h = String(node.style.height).toLowerCase();
    if (h === "fill" || h === "hug") {
      if (isParentAutoLayout && "layoutSizingVertical" in figmaNode) {
        figmaNode.layoutSizingVertical = h.toUpperCase();
      }
      hasFillOrHug = true;
    }
  }

  if (!hasFillOrHug) {
    const widthIsNum = typeof node.style.width === "number";
    const heightIsNum = typeof node.style.height === "number";
    if (widthIsNum || heightIsNum) {
      if ("resize" in figmaNode) {
        const targetW = widthIsNum ? Number(node.style.width) : (figmaNode.width || 1);
        const targetH = heightIsNum ? Number(node.style.height) : (figmaNode.height || 1);
        figmaNode.resize(targetW, targetH);
      }
    }
  }
}

async function renderNode(node, parent) {
  if (!node || !node.type) return null;
  const t = String(node.type).toLowerCase();
  let figmaNode = null;

  if (t === "frame" || t === "container") {
    figmaNode = createFrame(node);
  } else if (t === "text") {
    figmaNode = await createText(node);
  } else if (t === "image") {
    figmaNode = createImage(node);
  }

  if (!figmaNode) return null;

  if (parent) {
    parent.appendChild(figmaNode);
  }

  applyLayout(node, figmaNode);
  applyStyle(node, figmaNode);

  if ((t === "frame" || t === "container") && Array.isArray(node.children)) {
    await Promise.all(node.children.map((child) => renderNode(child, figmaNode)));
  }

  return figmaNode;
}

async function renderFromSSOT(json) {
  try {
    const renderedNode = await renderNode(json, null);
    if (renderedNode && renderedNode.type === "FRAME") {
      figma.currentPage.appendChild(renderedNode);
      // 생성된 노드로 화면 이동
      figma.currentPage.selection = [renderedNode];
      figma.viewport.scrollAndZoomIntoView([renderedNode]);
      return renderedNode;
    }
    return null;
  } catch (error) {
    if (figma && figma.notify) {
      figma.notify("오류 발생: " + error.message, { error: true });
    }
    return null;
  }
}


// --- [Phase 4: AI Layer - Templateization & Data Binding Engine] ---

// [SSOT 템플릿 저장소]
// 규칙: width/height → 숫자 | "fill" | "hug" 만 허용 ({type:"fixed"} 절대 금지)
// 규칙: layout.mode → 반드시 대문자 ("HORIZONTAL" | "VERTICAL")
const TEMPLATE_REGISTRY = {
  "product_card": {
    "type": "frame",
    "layout": { "mode": "VERTICAL", "padding": "token.spacing.md", "spacing": "token.spacing.sm" },
    "style": { "width": "hug", "height": "hug" },
    "children": [
      { "type": "image", "content": "{{imageUrl}}", "style": { "width": 200, "height": 200 } },
      { "type": "text", "content": "{{title}}", "style": { "width": "fill", "height": "hug" } },
      { "type": "text", "content": "{{price}}원", "style": { "width": "fill", "height": "hug" } }
    ]
  },
  "promotion_banner": {
    "type": "frame",
    "layout": { "mode": "HORIZONTAL", "padding": "token.spacing.lg", "spacing": "token.spacing.md" },
    "style": { "width": "fill", "height": 120 },
    "children": [
      {
        "type": "frame",
        "layout": { "mode": "VERTICAL", "padding": "token.spacing.none", "spacing": "token.spacing.xs" },
        "style": { "width": "fill", "height": "hug" },
        "children": [
          { "type": "text", "content": "{{badge}}", "style": { "width": "hug", "height": "hug" } },
          { "type": "text", "content": "{{headline}}", "style": { "width": "fill", "height": "hug" } }
        ]
      },
      { "type": "text", "content": "{{cta_text}}", "style": { "width": "hug", "height": "hug" } }
    ]
  },
  "list_ui": {
    "type": "frame",
    "layout": { "mode": "HORIZONTAL", "padding": "token.spacing.md", "spacing": "token.spacing.md" },
    "style": { "width": "fill", "height": "hug" },
    "children": [
      { "type": "text", "content": "{{index}}.", "style": { "width": 24, "height": "hug" } },
      { "type": "text", "content": "{{item_name}}", "style": { "width": "fill", "height": "hug" } },
      { "type": "text", "content": "{{status}}", "style": { "width": "hug", "height": "hug" } }
    ]
  },
  "header_simple": {
    "type": "frame",
    "layout": { "mode": "HORIZONTAL", "padding": "token.spacing.md", "spacing": "token.spacing.md" },
    "style": { "width": "fill", "height": 64 },
    "children": [
      { "type": "image", "content": "{{logoUrl}}", "style": { "width": 32, "height": 32 } },
      { "type": "text", "content": "{{title}}", "style": { "width": "fill", "height": "hug" } },
      { "type": "text", "content": "메뉴", "style": { "width": "hug", "height": "hug" } }
    ]
  }
};

function selectTemplateByRule(inputKeyword) {
  const keyword = String(inputKeyword).trim().toLowerCase();
  if (keyword.includes("상품") || keyword.includes("product")) return "product_card";
  if (keyword.includes("배너") || keyword.includes("banner")) return "promotion_banner";
  if (keyword.includes("리스트") || keyword.includes("list") || keyword.includes("목록")) return "list_ui";
  if (keyword.includes("헤더") || keyword.includes("header")) return "header_simple";
  return "product_card"; // 기본값
}

function bindDataToTemplate(templateObj, data) {
  const result = JSON.parse(JSON.stringify(templateObj));

  function traverseAndBind(obj) {
    if (typeof obj === "string") {
      return obj.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
        const dataValue = data[key.trim()];
        return (dataValue !== undefined && dataValue !== null) ? String(dataValue) : "";
      });
    } else if (Array.isArray(obj)) {
      return obj.map(item => traverseAndBind(item));
    } else if (typeof obj === "object" && obj !== null) {
      const boundObj = {};
      for (const k in obj) {
        boundObj[k] = traverseAndBind(obj[k]);
      }
      return boundObj;
    }
    return obj;
  }

  return traverseAndBind(result);
}

function generateSSOT(keyword, extractedData) {
  const templateId = selectTemplateByRule(keyword);
  const template = TEMPLATE_REGISTRY[templateId];
  return bindDataToTemplate(template, extractedData);
}

function validateSSOT(node) {
  if (!node || typeof node !== "object") throw new Error("Invalid SSOT node");

  if (node.type === "frame" || node.type === "container") {
    if (!node.layout || !node.layout.mode) throw new Error("Missing layout.mode");
    if (!Array.isArray(node.children)) node.children = [];
  }

  if (node.children !== undefined && !Array.isArray(node.children)) {
    throw new Error("Invalid children");
  }

  if (node.style) {
    var width = node.style.width;
    var height = node.style.height;

    var valid = function(v) {
      return typeof v === "number" || v === "fill" || v === "hug";
    };

    if (width !== undefined && !valid(width)) throw new Error("Invalid width");
    if (height !== undefined && !valid(height)) throw new Error("Invalid height");
  }

  if (node.children && Array.isArray(node.children)) {
    for (var i = 0; i < node.children.length; i++) {
      validateSSOT(node.children[i]);
    }
  }

  return node;
}

function ensureImage(node) {
  if (node.type === "image") {
    var val = String(node.content || "").trim();

    if (!val || (val.indexOf("http://") !== 0 && val.indexOf("https://") !== 0)) {
      node.content = "https://via.placeholder.com/300";
    }
  }

  if (node.children && Array.isArray(node.children)) {
    for (var i = 0; i < node.children.length; i++) {
      ensureImage(node.children[i]);
    }
  }
}

function deepFreeze(obj, seen) {
  if (!seen) seen = new Set();
  if (!obj || typeof obj !== "object" || seen.has(obj)) return obj;

  seen.add(obj);
  Object.freeze(obj);

  var keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++) {
    var val = obj[keys[i]];
    if (val && typeof val === "object") {
      deepFreeze(val, seen);
    }
  }

  return obj;
}

function handleError(e) {
  var msg = (e.message || "").toLowerCase();

  if (msg.indexOf("template") !== -1) return "템플릿 매핑 실패";

  if (
    msg.indexOf("layout") !== -1 ||
    msg.indexOf("width") !== -1 ||
    msg.indexOf("height") !== -1 ||
    msg.indexOf("invalid ssot") !== -1 ||
    msg.indexOf("children") !== -1
  ) {
    return "SSOT 구조 오류";
  }

  if (msg.indexOf("image") !== -1) return "이미지 처리 실패";

  return "생성 실패: " + e.message;
}

// --- [UI 통신 및 플러그인 초기화 (Main Logic)] ---

async function main() {
  try {
    const selection = figma.currentPage.selection;
    if (selection.length === 0 || !(selection[0].type === "FRAME" || selection[0].type === "COMPONENT" || selection[0].type === "INSTANCE")) {
      figma.notify("기준이 되는 프레임이나 컴포넌트를 선택해 주세요.", { error: true });
      figma.closePlugin();
      return;
    }

    const targetFrame = selection[0];
    openUI(targetFrame);
  } catch (err) {
    console.error(err);
    figma.closePlugin();
  }
}

async function openUI(targetFrame) {
  function highlightNode(node) {
    try {
      const oldStrokes = node.strokes ? node.strokes.slice() : [];
      const oldWeight = node.strokeWeight;
      node.strokes = [{ type: 'SOLID', color: { r: 0.09, g: 0.62, b: 0.98 } }];
      node.strokeWeight = Math.max(3, oldWeight * 2);
      setTimeout(() => {
        try { node.strokes = oldStrokes; node.strokeWeight = oldWeight; } catch (e) { }
      }, 800);
    } catch (e) { }
  }

  async function getGroupedFields() {
    let result = [];
    const processedNodes = new Set();
    const rowCardsMap = new Map();
    const standaloneFields = [];

    const allNodes = targetFrame.findAll(n => n.type === "TEXT" || n.type === "IMAGE" || (n.fills && Array.isArray(n.fills) && n.fills.some(f => f.type === "IMAGE")));

    for (const node of allNodes) {
      if (processedNodes.has(node.id)) continue;
      processedNodes.add(node.id);

      let parentRow = null;
      let curr = node.parent;
      while (curr && curr !== targetFrame && curr.type !== "PAGE") {
        if (curr.type === "FRAME" && curr.layoutMode === "VERTICAL" && curr.name.startsWith("Layout_")) {
          parentRow = curr;
          break;
        }
        curr = curr.parent;
      }

      let isImage = node.type === "IMAGE" || (node.fills && Array.isArray(node.fills) && node.fills.some(f => f.type === "IMAGE"));

      let fieldData = null;
      if (!isImage) {
        let fSize = 12; let fWeight = "Regular"; let fColor = "#000000";
        if (node.fontSize !== figma.mixed) fSize = node.fontSize;
        if (node.fontName !== figma.mixed) fWeight = node.fontName.style;
        if (node.fills !== figma.mixed && node.fills.length > 0 && node.fills[0].type === 'SOLID') {
          const r = Math.round(node.fills[0].color.r * 255).toString(16).padStart(2, '0');
          const g = Math.round(node.fills[0].color.g * 255).toString(16).padStart(2, '0');
          const b = Math.round(node.fills[0].color.b * 255).toString(16).padStart(2, '0');
          fColor = `#${r}${g}${b}`.toUpperCase();
        } else { fColor = "mixed"; }

        fieldData = {
          id: node.id, type: "FIELD", fieldType: "TEXT",
          characters: node.characters, label: node.characters.substring(0, 10).replace(/\n/g, ' ') || "텍스트",
          fontSize: fSize, fontWeight: fWeight, fillColor: fColor,
          visible: node.visible
        };
      } else {
        fieldData = {
          id: node.id, type: "FIELD", fieldType: "IMAGE",
          label: "이미지 변경", visible: node.visible
        };
      }

      if (parentRow) {
        if (!rowCardsMap.has(parentRow.id)) {
          rowCardsMap.set(parentRow.id, { node: parentRow, fields: [] });
        }
        rowCardsMap.get(parentRow.id).fields.push(fieldData);
      } else {
        standaloneFields.push(fieldData);
      }
    }

    for (const [rowId, data] of rowCardsMap.entries()) {
      const rowNode = data.node;
      const fields = data.fields;

      let longestText = "";
      let numberAttr = "";
      fields.forEach(f => {
        if (f.fieldType === "TEXT") {
          if (f.characters.length > longestText.length) longestText = f.characters;
          const lowerT = f.characters.toLowerCase();
          if (/[0-9]/.test(lowerT) && (lowerT.includes('만') || lowerT.includes('원') || lowerT.includes('샷') || lowerT.includes('회') || lowerT.includes('%'))) {
            if (!numberAttr || f.characters.length < numberAttr.length) numberAttr = f.characters;
          }
        }
      });

      let mainLabel = longestText.substring(0, 10).replace(/\n/g, ' ');
      if (longestText.length > 10) mainLabel += "...";
      const autoName = numberAttr ? `🏷️ [${mainLabel}] ${numberAttr.substring(0, 8).replace(/\n/g, '')}` : `🏷️ [${mainLabel}] 그룹`;

      result.push({
        type: "ROW_CARD", id: rowNode.id, name: rowNode.name, autoName: autoName,
        visible: rowNode.visible, fields: fields
      });
    }

    result = result.concat(standaloneFields);

    return result;
  }

  figma.showUI(__html__, { width: 380, height: 680, themeColors: true });
  figma.ui.postMessage({ type: 'init-fields', groups: await getGroupedFields() });

  figma.on("selectionchange", () => {
    const selectionIds = figma.currentPage.selection.map(n => n.id);
    figma.ui.postMessage({ type: 'selection-changed', ids: selectionIds });
  });

  figma.ui.onmessage = async (msg) => {
    if (msg.type === 'focus-node') {
      const node = figma.getNodeById(msg.id);
      if (node && node.visible) {
        figma.currentPage.selection = [node];
        figma.viewport.scrollAndZoomIntoView([node]);
        highlightNode(node);
      }
    }

    if (msg.type === 'clone-group') {
      const targetNode = figma.getNodeById(msg.id);
      if (targetNode && targetNode.type === "FRAME" && targetNode.parent) {
        try {
          const clone = targetNode.clone();
          targetNode.parent.insertChild(targetNode.parent.children.indexOf(targetNode) + 1, clone);
          clone.visible = true;
          figma.notify(`➕ 항목이 복제되었습니다.`);
          figma.ui.postMessage({ type: 'init-fields', groups: await getGroupedFields() });
        } catch (e) { figma.notify("복제 오류 발생", { error: true }); }
      }
    }

    if (msg.type === 'soft-delete-group') {
      const targetNode = figma.getNodeById(msg.id);
      if (targetNode) {
        targetNode.visible = false;
        figma.notify(`👁️ 숨김 처리되었습니다.`);
        figma.ui.postMessage({ type: 'init-fields', groups: await getGroupedFields() });
      }
    }

    if (msg.type === 'restore-group') {
      const targetNode = figma.getNodeById(msg.id);
      if (targetNode) {
        targetNode.visible = true;
        figma.notify(`🚀 성공적으로 복구되었습니다.`);
        figma.ui.postMessage({ type: 'init-fields', groups: await getGroupedFields() });
      }
    }

    if (msg.type === 'hard-delete-group') {
      const targetNode = figma.getNodeById(msg.id);
      if (targetNode) {
        targetNode.remove();
        figma.notify(`🗑️ 영구 삭제되었습니다.`);
        figma.ui.postMessage({ type: 'init-fields', groups: await getGroupedFields() });
      }
    }

    if (msg.type === 'update-texts') {
      let successCount = 0;
      for (const update of msg.updates) {
        const node = figma.getNodeById(update.id);
        if (node && node.type === "TEXT") {
          try {
            let changed = false;

            if (update.characters !== undefined && node.characters !== update.characters) {
              if (!node.hasMissingFont) {
                const len = node.characters.length;
                if (len > 0) {
                  const fontsToLoad = node.getRangeAllFontNames(0, len);
                  for (const f of fontsToLoad) await figma.loadFontAsync(f);
                }
                node.characters = update.characters;
                changed = true;
              }
            }

            if (update.fillHex && update.fillHex !== "MIXED") {
              const hex = update.fillHex;
              if (/^#[0-9A-F]{6}$/i.test(hex)) {
                const r = parseInt(hex.substr(1, 2), 16) / 255;
                const g = parseInt(hex.substr(3, 2), 16) / 255;
                const b = parseInt(hex.substr(5, 2), 16) / 255;

                const len = node.characters.length;
                if (len > 0) {
                  node.setRangeFills(0, len, [{ type: 'SOLID', color: { r, g, b } }]);
                } else {
                  node.fills = [{ type: 'SOLID', color: { r, g, b } }];
                }
                changed = true;
              }
            }

            if (changed) successCount++;
          } catch (e) { }
        }
      }
      figma.notify(`✨ ${successCount}건 업데이트 완료!`);
    }

    // ⭐️ 렌더링 엔진 실행
    if (msg.type === 'EXTRACT_JSON') {
      const selection = figma.currentPage.selection;
      if (selection.length > 0) {
        const rawJSON = extractNodeToJSON(selection[0]);
        const ssotJSON = await processFigmaJSON(rawJSON);

        console.log("Extracted & Normalized SSOT JSON:", JSON.stringify(ssotJSON, null, 2));
        figma.ui.postMessage({ type: 'extracted-json', data: ssotJSON });

        figma.notify("SSOT JSON 정제 완료! 렌더링을 시작합니다...", { timeout: 2000 });
        await renderFromSSOT(ssotJSON);

      } else {
        figma.notify("추출할 프레임을 선택해주세요.", { error: true });
      }
    }

    // ⭐️ [Phase 5] UI → generateSSOT → UI (Image Fetch) → renderFromSSOT
    if (msg.type === "GENERATE_SSOT") {
      try {
        figma.notify("디자인 생성 중...");

        if (!msg.keyword || typeof msg.keyword !== "string") {
          throw new Error("Invalid keyword");
        }

        if (!msg.data || typeof msg.data !== "object" || Array.isArray(msg.data)) {
          throw new Error("Invalid input data");
        }

        if (msg.data.style) delete msg.data.style;

        var ssot = generateSSOT(msg.keyword, msg.data);
        if (!ssot) throw new Error("Template not found");

        ssot = validateSSOT(ssot);
        ensureImage(ssot);
        deepFreeze(ssot);

        var renderedNode = await renderFromSSOT(ssot);

        if (renderedNode) {
          figma.currentPage.selection = [renderedNode];
          figma.viewport.scrollAndZoomIntoView([renderedNode]);
          figma.notify("✨ 렌더링 완료 (검증 통과)");
        }

      } catch (e) {
        console.error(e);
        figma.notify(handleError(e), { error: true });
      }
    }

    if (msg.type === 'RENDER_FINAL_SSOT') {
       try {
          figma.notify("디자인 렌더링 시작...");
          const renderedNode = await renderFromSSOT(msg.data);
          if (renderedNode) {
             figma.currentPage.selection = [renderedNode];
             figma.viewport.scrollAndZoomIntoView([renderedNode]);
             figma.notify("✨ 디자인 렌더링 완료!");
          }
       } catch (e) {
          figma.notify("렌더링 오류", { error: true });
       }
    }

    if (msg.type === 'close') figma.closePlugin();
  };
}

main();