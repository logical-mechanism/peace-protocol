# SNARK

Lets use GNARK to build a SNARK.

## Install GNARK

(GNARK GitHub)[https://github.com/Consensys/gnark]

(Getting Started)[https://docs.gnark.consensys.net/HowTo/get_started]

## Running

```bash
go mod tidy
```

```bash
go run snark -a 44203 -w acab
```

```bash
go test tests/*
```