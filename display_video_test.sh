#!/bin/bash
# Display/video path diagnostic. Non-destructive.
set +u
export LC_ALL=C
LOG='/tmp/display-video-test.log'; : > "$LOG"
say(){ printf '%s\n' "$*" | tee -a "$LOG"; }
say '============================================================'
say 'MODE=DISPLAY_VIDEO_DIAGNOSTIC_V1'
say 'RU: Проверка GPU/display-path и визуальных артефактов. Автоматическая проверка физической матрицы невозможна без внешнего эталона.'
say 'EN: GPU/display-path and visual-artifact diagnostic. The physical panel cannot be fully auto-verified without an external reference.'
say '============================================================'

if command -v system_profiler >/dev/null 2>&1; then
  say 'DISPLAY_INVENTORY_BEGIN'
  system_profiler SPDisplaysDataType 2>&1 | tee -a "$LOG"
  say 'DISPLAY_INVENTORY_END'
fi
if command -v ioreg >/dev/null 2>&1; then
  say 'FRAMEBUFFER_IOREG_BEGIN'
  ioreg -l 2>/dev/null | grep -Ei 'AMD|Radeon|AppleIntel|framebuffer|display|VRAM|IODisplay|AGDC|AppleGraphics' | head -n 350 | tee -a "$LOG"
  say 'FRAMEBUFFER_IOREG_END'
fi
if command -v log >/dev/null 2>&1; then
  say 'GPU_LOG_SCAN_BEGIN'
  log show --last 1h --style compact --predicate 'eventMessage CONTAINS[c] "GPU" OR eventMessage CONTAINS[c] "Radeon" OR eventMessage CONTAINS[c] "WindowServer" OR eventMessage CONTAINS[c] "framebuffer" OR eventMessage CONTAINS[c] "AGDC"' 2>/dev/null | tail -n 400 | tee -a "$LOG"
  say 'GPU_LOG_SCAN_END'
fi

# Generate deterministic visual patterns for a manual panel/framebuffer inspection.
PPM='/tmp/display-pattern.ppm'
if command -v perl >/dev/null 2>&1; then
  perl - "$PPM" <<'PERL'
use strict; use warnings;
my $f=shift; open my $O,'>:raw',$f or exit 1;
my($w,$h)=(1024,768); print $O "P6\n$w $h\n255\n";
for my $y(0..$h-1){for my $x(0..$w-1){my($r,$g,$b); if($y<$h/4){$r=int(255*$x/($w-1));$g=0;$b=255-$r;} elsif($y<$h/2){my$v=(($x>>3)^($y>>3))&1?255:0;$r=$g=$b=$v;} elsif($y<3*$h/4){$r=($x%2)?255:0;$g=($x%2)?0:255;$b=0;} else {$r=$x%256;$g=$y%256;$b=($x+$y)%256;} print $O pack('C3',$r,$g,$b);}}
close $O;
PERL
  if [ -s "$PPM" ] && command -v open >/dev/null 2>&1; then
    open "$PPM" >/dev/null 2>&1 || true
    say "VISUAL_PATTERN_OPENED=$PPM"
    say 'RU: Осмотрите изображение: не должно быть случайных точек, полос, блоков, мерцаний или изменяющихся участков.'
    say 'EN: Inspect the pattern: there should be no random dots, stripes, blocks, flicker, or changing regions.'
  else
    say 'VISUAL_PATTERN=GENERATED_BUT_CANNOT_OPEN_IN_THIS_ENVIRONMENT'
  fi
fi

say 'RESULT=INCONCLUSIVE_MANUAL_VISUAL_COMPONENT'
say 'RU: Этот тест собирает данные GPU/display path и создаёт визуальный эталон, но сам по себе не может доказать исправность матрицы/шлейфа.'
say 'EN: This test collects GPU/display-path data and generates a visual reference, but cannot by itself prove the panel/cable is healthy.'
say 'NEXT_RU: Если артефакт виден глазами, сделайте screenshot. Артефакт есть в screenshot — подозрение GPU/framebuffer/VRAM/RAM; screenshot чистый — подозрение матрица/eDP/TCON.'
say 'NEXT_EN: If an artifact is visible, take a screenshot. Artifact in screenshot suggests GPU/framebuffer/VRAM/RAM; clean screenshot suggests panel/eDP/TCON.'
exit 3
