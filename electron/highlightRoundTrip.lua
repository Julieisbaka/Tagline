local highlight_classes = {
  mark = true,
  highlight = true,
  highlighted = true,
}

local function is_highlight(span)
  local style = (span.attributes.style or ""):lower()
  local has_background = style:match("background%-color%s*:%s*([^;]+)")
    or style:match("background%s*:%s*([^;]+)")
  if has_background and not has_background:match("^%s*transparent%s*$") then return true end

  for _, class in ipairs(span.classes) do
    if highlight_classes[class:lower()] then return true end
  end
  return false
end

function Span(span)
  if not is_highlight(span) then return end
  if FORMAT == "rtf" then
    local result = { pandoc.RawInline("rtf", "{\\highlight99 ") }
    for _, inline in ipairs(span.content) do result[#result + 1] = inline end
    result[#result + 1] = pandoc.RawInline("rtf", "}")
    return result
  end
  return pandoc.Span(span.content, pandoc.Attr("", { "mark" }))
end
