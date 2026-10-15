#!/usr/bin/perl
# SPDX-License-Identifier: GPL-3.0-or-later
use strict;
use warnings;
use utf8;
use JSON::PP;
use Digest::SHA qw(sha256_hex);
use Fcntl qw(O_WRONLY O_CREAT O_EXCL O_NOFOLLOW);
use MacDiag::Runner;
use MacDiag::Registry;
use MacDiag::Detect;
use MacDiag::Adapters;

binmode STDOUT, ':encoding(UTF-8)';
binmode STDERR, ':encoding(UTF-8)';
umask 0077;
my $VERSION = '0.1.0';
sub json { JSON::PP->new->canonical->pretty->encode($_[0]) }
sub help {
    print <<'HELP';
MacDiag Core 0.1.0 — профиль среды и безопасный диспетчер.

macdiag profile collect [--format text|json] [--output NEW.json]
macdiag profile diff --before OLD.json --after NEW.json
macdiag tests list [--compatible] [--snapshot FILE.json]
macdiag plan --workflow basic|network|vpn.install [--snapshot FILE.json]
macdiag run --test ID | --suite basic|network

Общие параметры: --policy observe|diagnostic, --profile auto|limited
Сетевые запросы: --policy diagnostic --allow-network
Вывод JSON: --format json; сохранить: --output NEW.json (без перезаписи)
Служба для read-only запроса: --service LABEL (по умолчанию наш VPN).

По умолчанию сеть не используется, службы/маршруты/диски не меняются.
run всегда собирает живой профиль. Из сохранённого JSON допустим только план.
Никаких --force, sudo, установки пакетов или произвольного кода из профилей.
Операции установки VPN, нагрузочные и дисковые тесты пока BLOCKED/NOT_IMPLEMENTED.
HELP
}
sub write_new {
    my ($path,$data)=@_;
    sysopen(my $fh,$path,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0600) or die "OUTPUT_EXISTS_OR_UNWRITABLE\n";
    binmode $fh;
    my $bytes=JSON::PP->new->canonical->pretty->utf8->encode($data);
    my $offset=0;
    while ($offset < length($bytes)) {
        my $n=syswrite($fh,$bytes,length($bytes)-$offset,$offset);
        die "OUTPUT_WRITE_FAILED\n" unless defined($n) && $n>0;
        $offset+=$n;
    }
    close($fh) or die "OUTPUT_CLOSE_FAILED\n";
}
sub snapshot {
    my ($path)=@_;
    my $s=MacDiag::Registry::read_json($path);
    die "SNAPSHOT_SCHEMA\n" unless ($s->{schema}||'') eq 'macdiag.profile.v1' && ref($s->{facts}) eq 'HASH' && ref($s->{tools}) eq 'HASH' && ref($s->{capabilities}) eq 'HASH';
    for my $v (values %{$s->{facts}}) { die "SNAPSHOT_FACT_TYPE\n" if ref($v) }
    return $s;
}
sub text_profile {
    my ($s)=@_;my $f=$s->{facts};
    print "MacDiag Core $VERSION\n";
    for my $pair (["Модель",'model_identifier'],["Семейство железа",'hardware_family'],["Архитектура процесса",'process_arch'],["Загруженная ОС",'os_version'],["Сборка ОС",'os_build'],["Среда",'environment'],["Уверенность среды",'environment_confidence'],["RAM, байт",'ram_bytes']) {
        print $pair->[0].': '.MacDiag::Detect::clean($f->{$pair->[1]} // 'unknown')."\n";
    }
    print "Bash запуска: ".$s->{engine}{dispatcher_bash}."; системный Bash: ".($s->{tools}{bash}{version}||'unknown')."\n";
    print "Профиль правил: ".($s->{selection}{id}||$s->{selection}{state})."\n";
    print "Отпечаток: $s->{profile_fingerprint}\n";
    print "Это паспорт окружения, не заключение об исправности оборудования.\n";
    print "Сеть не запрашивалась. Серийные номера, UUID, имена пользователей не собирались.\n";
}
sub flatten {
    my ($x,$prefix,$out)=@_;
    if (ref($x) eq 'HASH') {flatten($x->{$_},$prefix eq ''?$_:$prefix.'.'.$_,$out) for sort keys %$x}
    else {$out->{$prefix}=JSON::PP->new->canonical->encode($x)}
}
sub main {
    my ($root,$bash,$origin)=splice @ARGV,0,3;
    die "WRAPPER_REQUIRED\n" unless defined($root) && $root =~ m{\A/} && defined($bash) && $bash =~ /\A[0-9][A-Za-z0-9.()+_-]{0,79}\z/;
    die "ORIGIN_INVALID\n" unless defined($origin) && $origin =~ m{\A/};
    my $command=shift(@ARGV)||'help';
    if ($command eq 'help' || $command eq '--help') {die "UNEXPECTED_ARGUMENT\n" if @ARGV;help();return 0}
    if ($command eq 'version') {die "UNEXPECTED_ARGUMENT\n" if @ARGV;print "$VERSION\n";return 0}
    my $action='';
    $action=shift(@ARGV)||'' if $command eq 'profile' || $command eq 'tests';
    my %o=(policy=>'observe',profile=>'auto',format=>'text');
    while (@ARGV) {
        my $key=shift @ARGV;
        if ($key eq '--allow-network') {die "DUPLICATE_OPTION\n" if $o{allow_network};$o{allow_network}=1;next}
        if ($key eq '--compatible') {$o{compatible}=1;next}
        die "UNKNOWN_OPTION\n" unless $key =~ /\A--(format|output|policy|profile|snapshot|test|suite|workflow|before|after|service)\z/;
        my $name=$1;die "MISSING_OPTION_VALUE\n" unless @ARGV;
        die "DUPLICATE_OPTION\n" if $o{'seen_'.$name}++;
        $o{$name}=shift @ARGV;
    }
    for my $field (qw(output snapshot before after)) { $o{$field}=$origin.'/'.$o{$field} if defined($o{$field}) && $o{$field} !~ m{\A/} }
    die "INVALID_POLICY\n" unless $o{policy} =~ /\A(?:observe|diagnostic)\z/;
    die "INVALID_FORMAT\n" unless $o{format} =~ /\A(?:text|json)\z/;
    die "PROFILE_OVERRIDE_FORBIDDEN\n" unless $o{profile} =~ /\A(?:auto|limited)\z/;
    $o{policy}='observe' if $o{profile} eq 'limited';
    die "SNAPSHOT_CANNOT_AUTHORIZE_EXECUTION\n" if $o{snapshot} && $command ne 'plan' && !($command eq 'tests' && $action eq 'list');
    die "COMMAND_INVALID\n" unless ($command eq 'profile' && $action =~ /\A(?:collect|diff)\z/) || ($command eq 'tests' && $action eq 'list') || $command eq 'plan' || $command eq 'run';
    
    my %specific;
    if ($command eq 'profile' && $action eq 'diff') {%specific=map {$_=>1} qw(before after)}
    elsif ($command eq 'tests') {%specific=map {$_=>1} qw(snapshot compatible)}
    elsif ($command eq 'plan') {%specific=map {$_=>1} qw(snapshot workflow test)}
    elsif ($command eq 'run') {%specific=map {$_=>1} qw(test suite service)}
    for my $key (qw(snapshot workflow test suite before after service compatible)) {
        die "OPTION_NOT_APPLICABLE\n" if exists($o{$key}) && !$specific{$key};
    }
    die "SELECT_EXACTLY_ONE_TARGET\n" if $o{workflow} && $o{test};
    my $reg=MacDiag::Registry->new($root.'/registry/catalog.json');
    my ($result,$code)=(undef,0);
    if ($command eq 'profile' && $action eq 'diff') {
        die "DIFF_REQUIRES_TWO_SNAPSHOTS\n" unless $o{before} && $o{after};
        my ($a,$b)=(snapshot($o{before}),snapshot($o{after}));my (%fa,%fb);
        for my $key (qw(facts tools engine registry_sha256)) {flatten($a->{$key},$key,\%fa);flatten($b->{$key},$key,\%fb)}
        my %keys=map {$_=>1} (keys %fa,keys %fb);
        my @changes=map {{field=>$_,before=>$fa{$_},after=>$fb{$_}}} grep {($fa{$_}//'null') ne ($fb{$_}//'null')} sort keys %keys;
        $result={schema=>'macdiag.diff.v1',changes=>\@changes,reprobe_required=>@changes ? JSON::PP::true:JSON::PP::false,note=>'Network/service state must always be re-probed, even when the fingerprint is unchanged.'};
    } else {
        my $s;
        if ($o{snapshot}) {$s=snapshot($o{snapshot})}
        else {
            my @code=map { MacDiag::Detect::fingerprint_tool($root.'/'.$_) || 'unreadable' } qw(macdiag bin/macdiag.pl lib/MacDiag/Runner.pm lib/MacDiag/Registry.pm lib/MacDiag/Detect.pm lib/MacDiag/Adapters.pm);
            my $revision=sha256_hex(join('\n',@code));
            my $detect=MacDiag::Detect->new(runner=>MacDiag::Runner->new,registry=>$reg,bash_version=>$bash,code_revision=>$revision);
            $s=$detect->collect();
        }
        if ($command eq 'profile') {$result=$s}
        else {
            my $plan=$reg->plan($s,%o,offline=>$o{snapshot}?1:0);
            if ($command eq 'tests') {
                $plan->{items}=[grep {$_->{state} eq 'AVAILABLE'} @{$plan->{items}}] if $o{compatible};
                $result=$plan;
            } else {
                die "SELECT_EXACTLY_ONE_TARGET\n" if ($command eq 'run' && ((!$o{test} && !$o{suite}) || ($o{test} && $o{suite}))) || ($command eq 'plan' && !$o{workflow} && !$o{test});
                my @ids;
                if ($o{test}) {@ids=($o{test})}
                else {
                    my $name=$o{suite}||$o{workflow};
                    my $w=$reg->data->{workflows}{$name};
                    die "WORKFLOW_UNKNOWN\n" unless ref($w) eq 'ARRAY';
                    @ids=@$w;
                }
                my %items=map {$_->{id}=>$_} @{$plan->{items}};
                die "MODULE_UNKNOWN\n" if grep {!exists $items{$_}} @ids;
                $plan->{items}=[map {$items{$_}} @ids];
                if ($command eq 'plan') {$result=$plan}
                else {
                    my @checks;
                    for my $id (@ids) {
                        my $item=$items{$id};
                        if ($item->{state} ne 'AVAILABLE') {push @checks,{id=>$id,state=>$item->{state},reason=>$item->{reason}};next}
                        my $r=MacDiag::Adapters::run_module($id,MacDiag::Runner->new,$s,%o);
                        push @checks,{id=>$id,%$r};
                    }
                    $code=(grep {$_->{state} eq 'ERROR' || $_->{state} eq 'FAIL'} @checks)?1:(grep {$_->{state} ne 'PASS'} @checks)?2:0;
                    $result={schema=>'macdiag.run.v1',profile_fingerprint=>$s->{profile_fingerprint},evidence=>'LIVE_EXECUTION',overall=>$code==0?'PASS':$code==1?'FAILED':'INCOMPLETE',checks=>\@checks,network_consent=>$o{allow_network}?JSON::PP::true:JSON::PP::false};
                }
            }
        }
    }
    write_new($o{output},$result) if $o{output};
    if ($o{format} eq 'json') {print json($result)}
    elsif ($result->{schema} eq 'macdiag.profile.v1') {text_profile($result)}
    elsif ($result->{schema} eq 'macdiag.plan.v1') {
        print "План: $result->{source}; профиль: ".($result->{selection}{id}||$result->{selection}{state})."\n";
        for my $i (@{$result->{items}}) {printf "%s  %-20s %s\n",$i->{state},$i->{id},$i->{reason}}
        print "AVAILABLE означает допустимость попытки, не успешный тест.\n";
    } else {print json($result)}
    print STDERR "Отчёт сохранён в указанный файл (0600, без перезаписи).\n" if $o{output};
    return $code;
}
my $rc=eval {main()};
if ($@) {my $e=$@;$e =~ s/\s+at .*//s;$e =~ s/[\x00-\x1f\x7f]//g;print STDERR "ОШИБКА: $e\n";exit 1}
exit $rc;
