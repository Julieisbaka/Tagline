local highlight_classes = {
  mark = true,
  highlight = true,
  highlighted = true,
}

function Span(span)
  local style = (span.attributes.style or ""):lower()
  local has_background = style:match("background%-color%s*:%s*([^;]+)")
    or style:match("background%s*:%s*([^;]+)")
  if has_background and not has_background:match("^%s*transparent%s*$") then
    return pandoc.Span(span.content, pandoc.Attr("", { "mark" }))
  end

  for _, class in ipairs(span.classes) do
    if highlight_classes[class:lower()] then
      return pandoc.Span(span.content, pandoc.Attr("", { "mark" }))
    end
  end
end
